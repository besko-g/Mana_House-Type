/* Offline encoders. MOV contains lossless RGBA PNG frames, so soft alpha is
 * preserved without browser-dependent video encoders or screen recording.
 * GIF has one transparent palette index; fixed spatial dithering represents
 * partial coverage without a matte or temporally flickering random noise. */
(() => {
  'use strict';
  const bytes=(...v)=>new Uint8Array(v),zero=n=>new Uint8Array(n);
  const ascii=s=>Uint8Array.from(s,c=>c.charCodeAt(0));
  const be16=n=>bytes(n>>>8,n&255),be32=n=>bytes(n>>>24,(n>>>16)&255,(n>>>8)&255,n&255);
  const le16=n=>bytes(n&255,(n>>>8)&255);
  const join=(...items)=>{const out=new Uint8Array(items.reduce((n,a)=>n+a.length,0));let p=0;for(const a of items){out.set(a,p);p+=a.length;}return out;};
  const atom=(type,...data)=>{const body=join(...data);return join(be32(body.length+8),ascii(type),body);};
  const full=(type,flags,...data)=>atom(type,be32(flags),...data);
  const matrix=join(...[65536,0,0,0,65536,0,0,0,1073741824].map(be32));
  const table=(type,rows)=>full(type,0,be32(rows.length),...rows.map(row=>join(...row.map(be32))));
  class MOVEncoder {
    constructor(width,height,duration,frameCount){
      this.width=width;this.height=height;this.duration=duration;this.frameCount=frameCount;this.frames=[];this.sizes=[];this.byteLength=0;
      if(!(width>0&&height>0&&width<=8192&&height<=8192&&duration>0&&frameCount>0))throw new Error('Invalid video dimensions or duration.');
    }
    add(blob){
      if(!blob||blob.type!=='image/png'||!blob.size)throw new Error('A video frame could not be encoded.');
      if(this.byteLength+blob.size>1000*1024*1024)throw new Error('This loop exceeds 1 GB. Choose a smaller export size or a shorter duration.');
      this.frames.push(blob);this.sizes.push(blob.size);this.byteLength+=blob.size;
    }
    finish(){
      const count=this.frames.length;if(count!==this.frameCount)throw new Error('The video is incomplete.');
      const timescale=60000,duration=Math.round(this.duration*timescale);
      const ftyp=atom('ftyp',ascii('qt  '),be32(0),ascii('qt  '));
      let offset=ftyp.length+8;const offsets=this.sizes.map(size=>{const at=offset;offset+=size;return [at];});
      const times=[];for(let i=0;i<count;i++){
        const delta=Math.round((i+1)*duration/count)-Math.round(i*duration/count),last=times.at(-1);
        if(last&&last[1]===delta)last[0]++;else times.push([1,delta]);
      }
      const name=zero(32);name.set(join(bytes(3),ascii('PNG')));
      const entry=atom('png ',zero(6),be16(1),zero(16),be16(this.width),be16(this.height),be32(72*65536),be32(72*65536),be32(0),be16(1),name,be16(32),be16(65535));
      const stbl=atom('stbl',full('stsd',0,be32(1),entry),table('stts',times),table('stsc',[[1,1,1]]),
        full('stsz',0,be32(0),be32(count),...this.sizes.map(be32)),table('stco',offsets));
      const dinf=atom('dinf',full('dref',0,be32(1),full('url ',1)));
      const minf=atom('minf',full('vmhd',1,zero(8)),dinf,stbl);
      const mdhd=full('mdhd',0,zero(8),be32(timescale),be32(duration),zero(4));
      const hdlr=full('hdlr',0,be32(0),ascii('vide'),zero(12),ascii('Mana Type Video\0'));
      const tkhd=full('tkhd',7,zero(8),be32(1),be32(0),be32(duration),zero(16),matrix,be32(this.width*65536),be32(this.height*65536));
      const mvhd=full('mvhd',0,zero(8),be32(timescale),be32(duration),be32(65536),be16(0),zero(10),matrix,zero(24),be32(2));
      const moov=atom('moov',mvhd,atom('trak',tkhd,atom('mdia',mdhd,hdlr,minf)));
      return new Blob([ftyp,be32(this.byteLength+8),ascii('mdat'),...this.frames,moov],{type:'video/quicktime'});
    }
  }
  function lzw(indices){
    const out=[];let bits=0,bitCount=0,width=9,next=258,dict=new Map();
    const emit=code=>{bits|=code<<bitCount;bitCount+=width;while(bitCount>=8){out.push(bits&255);bits>>>=8;bitCount-=8;}};
    emit(256);let prefix=indices[0];
    for(let i=1;i<indices.length;i++){
      const value=indices[i],key=prefix*256+value,match=dict.get(key);
      if(match!==undefined){prefix=match;continue;}
      emit(prefix);
      // The decoder adds the previous sequence after reading the next code.
      // Grow after that code is emitted, not when our dictionary fills.
      if(next===(1<<width)&&width<12)width++;
      if(next<4096)dict.set(key,next++);
      else{emit(256);dict=new Map();width=9;next=258;}
      prefix=value;
    }
    emit(prefix);if(next===(1<<width)&&width<12)width++;emit(257);if(bitCount)out.push(bits&255);
    return Uint8Array.from(out);
  }
  function threshold(x,y){
    let v=(Math.imul(x+1,1597334677)^Math.imul(y+1,3812015801))>>>0;
    v=Math.imul(v^(v>>>16),2246822507);v=Math.imul(v^(v>>>13),3266489909);
    return ((v^(v>>>16))>>>0)/4294967296;
  }
  const rgb=hex=>[1,3,5].map(k=>parseInt(hex.slice(k,k+2),16));
  class GIFEncoder {
    constructor(width,height,ink,background,duration,frameCount){
      this.width=width;this.height=height;this.transparent=background===null;this.frames=0;this.frameCount=frameCount;this.duration=duration;
      this.ink=rgb(ink);this.bg=rgb(background||'#000000');this.projection=this.ink.map((v,i)=>v-this.bg[i]);
      this.norm=this.projection.reduce((v,x)=>v+x*x,0)||1;
      const palette=new Uint8Array(768);
      for(let i=0;i<256;i++)for(let c=0;c<3;c++)palette[i*3+c]=this.transparent?this.ink[c]:Math.round(this.bg[c]+this.projection[c]*i/255);
      this.parts=[ascii('GIF89a'),le16(width),le16(height),bytes(247,0,0),palette,
        bytes(33,255,11),ascii('NETSCAPE2.0'),bytes(3,1,0,0,0)];
      if(this.transparent){this.thresholds=new Uint8Array(width*height);for(let y=0;y<height;y++)for(let x=0;x<width;x++)this.thresholds[y*width+x]=Math.floor(threshold(x,y)*255);}
      this.byteLength=0;
    }
    add(rgba){
      if(rgba.length!==this.width*this.height*4)throw new Error('Unexpected GIF frame dimensions.');
      const indices=new Uint8Array(this.width*this.height);
      if(this.transparent){for(let i=0;i<indices.length;i++)indices[i]=rgba[i*4+3]>this.thresholds[i]?1:0;}
      else{for(let i=0;i<indices.length;i++){
        let projection=0;for(let c=0;c<3;c++)projection+=(rgba[i*4+c]-this.bg[c])*this.projection[c];
        indices[i]=Math.max(0,Math.min(255,Math.round(255*projection/this.norm)));
      }}
      const i=this.frames++,delay=Math.round((i+1)*this.duration*100/this.frameCount)-Math.round(i*this.duration*100/this.frameCount);
      const data=lzw(indices),blocks=[];for(let p=0;p<data.length;p+=255)blocks.push(bytes(Math.min(255,data.length-p)),data.subarray(p,p+255));
      this.byteLength+=data.length;if(this.byteLength>500*1024*1024)throw new Error('This GIF exceeds 500 MB. Choose a smaller export size or a shorter duration.');
      this.parts.push(bytes(33,249,4,this.transparent?9:4),le16(delay),bytes(0,0),bytes(44),zero(4),le16(this.width),le16(this.height),bytes(0,8),...blocks,bytes(0));
    }
    finish(){if(this.frames!==this.frameCount)throw new Error('The GIF is incomplete.');return new Blob([...this.parts,bytes(59)],{type:'image/gif'});}
  }
  globalThis.ManaExport={MOVEncoder,GIFEncoder};
})();
