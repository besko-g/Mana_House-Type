/* GPU acceleration for the approved density engines. All intermediate coverage
 * stays floating point. Grain is thresholded only at composition, including
 * during breathing; particles never become semitransparent crossfade sprites. */
(() => {
  'use strict';
  const W=2400,H=1350;
  const SIGMAS=[0,...Array.from({length:13},(_,i)=>.7*1.5**i)];
  const head=`#version 300 es
precision highp float; precision highp int; precision highp sampler2D; precision highp usampler2D;
out vec4 outColor;
float sat(float x){return clamp(x,0.,1.);}
float bilinear(sampler2D t,vec2 p){ivec2 s=textureSize(t,0);ivec2 i=ivec2(floor(p));vec2 f=fract(p);
 if(p.x<0.||p.y<0.||p.x>=float(s.x-1)||p.y>=float(s.y-1))return 0.;
 return mix(mix(texelFetch(t,i,0).r,texelFetch(t,i+ivec2(1,0),0).r,f.x),mix(texelFetch(t,i+ivec2(0,1),0).r,texelFetch(t,i+ivec2(1,1),0).r,f.x),f.y);}
float bounded(sampler2D t,vec2 p){vec2 s=vec2(textureSize(t,0));p=clamp(p,vec2(0.),s-1.0001);ivec2 i=ivec2(p);vec2 f=fract(p);
 return mix(mix(texelFetch(t,i,0).r,texelFetch(t,i+ivec2(1,0),0).r,f.x),mix(texelFetch(t,i+ivec2(0,1),0).r,texelFetch(t,i+ivec2(1,1),0).r,f.x),f.y);}
uint ihash(ivec2 p,uint seed){uint t=uint(p.x)*1597334677u^uint(p.y)*3812015801u^seed;t=(t^(t>>16u))*2246822507u;t=(t^(t>>13u))*3266489909u;return t^(t>>16u);}
float inoise(vec2 p,uint seed){ivec2 i=ivec2(floor(p));vec2 f=fract(p);return mix(mix(float(ihash(i,seed)),float(ihash(i+ivec2(1,0),seed)),f.x),mix(float(ihash(i+ivec2(0,1),seed)),float(ihash(i+ivec2(1,1),seed)),f.x),f.y)/4294967296.;}
float hhash(vec2 p,float seed){return fract(sin(dot(p,vec2(127.1,311.7))+seed*.019)*43758.5453123);}
float hnoise(vec2 p,float seed){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hhash(i,seed),hhash(i+vec2(1,0),seed),f.x),mix(hhash(i+vec2(0,1),seed),hhash(i+vec2(1,1),seed),f.x),f.y);}
`;
  const deformField=head+`
uniform float seed;uniform int count;uniform vec4 spots[20];uniform vec2 gains[20];
float offset(vec2 p){float value=0.;for(int n=0;n<20;n++){if(n>=count)break;vec4 s=spots[n];vec2 d=p-s.xy;if(abs(d.x)>s.z/.84||abs(d.y)>s.z/.84)continue;
 float c=cos(s.w),sn=sin(s.w);vec2 local=vec2(c*d.x+sn*d.y,(-sn*d.x+c*d.y)*gains[n].y);
 float irregular=hnoise(local/24.+s.xy/vec2(2400,1350)*91.,seed);
 float f=sat(1.-length(local)/s.z*mix(.84,1.16,irregular));value+=f*f*(3.-2.*f)*gains[n].x;}return value;}
void main(){outColor=vec4(offset(gl_FragCoord.xy),0,0,1);}`;
  const shape=head+`
uniform sampler2D sdf,deformation;uniform float seed,expansion,intensity;
float distanceAt(vec2 p){return bounded(sdf,p-.5)-bounded(deformation,p-.5)*intensity;}
void main(){vec2 p=gl_FragCoord.xy;float d=distanceAt(p);float grow=pow(expansion/100.,1.65)*160.;float a=d-grow;
 if(a>32.){outColor=vec4(0);return;}if(a< -32.){outColor=vec4(1,0,0,1);return;}
 float fine=hnoise(p*2./3.2+vec2(31,79),seed),micro=hnoise(p*2./1.45+vec2(113,47),seed);
 a+=(mix(fine,micro,.42)-.5)*min(grow*.12,12.);
 float dx=abs(distanceAt(p+vec2(1,0))-distanceAt(p-vec2(1,0)))*.5;
 float dy=abs(distanceAt(p+vec2(0,1))-distanceAt(p-vec2(0,1)))*.5;
 float soft=max(dx+dy,1.44)*.88,edge=1.-smoothstep(soft*.35,soft*4.+4.,abs(a));
 float alpha=(1.-smoothstep(-soft,soft,a))*(1.-smoothstep(0.,16.,grow)*edge*mix(.018,.11,micro));
 outColor=vec4(alpha,0,0,1);}`;
  const blurField=head+`
uniform vec4 spots[12];uniform int count;uniform float seed;
void main(){vec2 p=gl_FragCoord.xy;float field=0.;for(int i=0;i<12;i++){if(i>=count)break;vec4 s=spots[i];vec2 d=p-s.xy;
 if(abs(d.x)>s.z/.78||abs(d.y)>s.z/.78)continue;
 float n=hnoise(d/42.+s.xy/vec2(2400,1350)*73.+s.w*19.,seed);float f=sat(1.-length(d)/s.z*mix(.78,1.22,n));field+=f*f*(3.-2.*f)*s.w;}
 outColor=vec4(.68*min(1.5,field)*mix(.82,1.12,hnoise(p/84.+29.,seed)),0,0,1);}`;
  const gaussian=head+`
uniform sampler2D source;uniform vec2 destination,axis;uniform float weights[33];uniform int radius;uniform bool linearSampling;
float sampleAt(vec2 p){if(all(equal(destination,vec2(textureSize(source,0)))))return texelFetch(source,clamp(ivec2(p),ivec2(0),textureSize(source,0)-1),0).r;return bounded(source,p);}
void main(){vec2 p=gl_FragCoord.xy/destination*vec2(textureSize(source,0))-.5;
 float v=bounded(source,p)*weights[0];
 if(linearSampling){vec2 sz=vec2(textureSize(source,0));for(int i=1;i<=32;i+=2){if(i>radius)break;float w=weights[i]+(i<radius?weights[i+1]:0.);float f=float(i)+(i<radius?weights[i+1]/w:0.);vec2 d=axis*f;
 v+=(texture(source,(p+d+.5)/sz).r+texture(source,(p-d+.5)/sz).r)*w;}}
 else{for(int i=1;i<=32;i++){if(i>radius)break;vec2 d=axis*float(i);v+=(sampleAt(p+d)+sampleAt(p-d))*weights[i];}}
 outColor=vec4(v,0,0,1);}`;
  const heatResolve=head+`
uniform sampler2D levels[14],blurMap;uniform float blur,expansion,expansionBlur;
vec4 cubicWeights(float t){float t2=t*t,t3=t2*t;return vec4(1.-3.*t+3.*t2-t3,4.-6.*t2+3.*t3,1.+3.*t+3.*t2-3.*t3,t3)/6.;}
float cubic(sampler2D tex,vec2 uv){vec2 p=uv*vec2(textureSize(tex,0))-.5;ivec2 b=ivec2(floor(p));vec4 wx=cubicWeights(fract(p.x)),wy=cubicWeights(fract(p.y));float v=0.;ivec2 mx=textureSize(tex,0)-1;
 for(int y=0;y<4;y++)for(int x=0;x<4;x++)v+=texelFetch(tex,clamp(b+ivec2(x-1,y-1),ivec2(0),mx),0).r*wx[x]*wy[y];return v;}
float readLevel(sampler2D tex,vec2 uv){return textureSize(tex,0).x<2400?cubic(tex,uv):bounded(tex,uv*vec2(textureSize(tex,0))-.5);}
void main(){vec2 uv=gl_FragCoord.xy/vec2(2400,1350);float local=blur*texelFetch(blurMap,ivec2(gl_FragCoord.xy),0).r;
 float global=smoothstep(0.,.08,expansion/100.)*expansionBlur*.2;float s=.5*length(vec2(local,global));float v=0.;
${SIGMAS.slice(1).map((s,i)=>`${i?'else ':''}if(s<=${s.toFixed(8)}){float t=sat((s*s-${(SIGMAS[i]**2).toFixed(8)})/${(s*s-SIGMAS[i]**2).toFixed(8)});v=mix(readLevel(levels[${i}],uv),readLevel(levels[${i+1}],uv),t);}`).join('\n')}
else v=readLevel(levels[13],uv);outColor=vec4(sat(v),0,0,1);}`;
  const contract=head+`uniform sampler2D mask,dist;uniform float erosion;
void main(){ivec2 p=ivec2(gl_FragCoord.xy);float m=texelFetch(mask,p,0).r;outColor=vec4(erosion==0.?m:min(m,sat(texelFetch(dist,p,0).r-erosion)),0,0,1);}`;
  const down=head+`uniform sampler2D source;uniform vec2 axis;
void main(){ivec2 p=ivec2(gl_FragCoord.xy);ivec2 a=ivec2(axis);ivec2 at=p*(ivec2(1)+a);float value=0.;float k[5]=float[5](1.,4.,6.,4.,1.);ivec2 sz=textureSize(source,0);
for(int n=-2;n<=2;n++){ivec2 q=at+a*n;if(all(greaterThanEqual(q,ivec2(0)))&&all(lessThan(q,sz)))value+=texelFetch(source,q,0).r*k[n+2];}outColor=vec4(value/16.,0,0,1);}`;
  const coldResolve=head+`
uniform sampler2D levels[10],field;uniform uint seed;uniform float strength,spread,fade,stroke;uniform bool effectActive;
float levelSample(int l,vec2 p){${Array.from({length:10},(_,i)=>`if(l==${i})return bilinear(levels[${i}],p/${(2**i).toFixed(1)});`).join('')}return 0.;}
void main(){vec2 p=gl_FragCoord.xy-.5;float hot=bilinear(field,p/10.);
 float sigma=(effectActive?.62:0.)+stroke*1.75*spread*hot*strength,variance=sigma*sigma;
 int lo=int(clamp(floor(log2(1.+3.*variance)*.5),0.,8.));float va=(pow(4.,float(lo))-1.)/3.;float vb=(pow(4.,float(lo+1))-1.)/3.;float t=sat((variance-va)/(vb-va));
 float warp=(1.5+stroke*.12)*hot*strength;vec2 d=vec2(inoise(p/18.,seed+47u),inoise(p/22.,seed+59u))-.5;d*=warp;
 float alpha=mix(levelSample(lo,p+d),levelSample(lo+1,p+d),t);float v=pow(sat(alpha),1.+fade*.7*hot)*(1.-fade*hot*.10);
 outColor=vec4(v<.012?0.:v,0,0,1);}`;
  const present=head+`
uniform sampler2D base,low,high;uniform usampler2D thresholds;uniform vec3 ink,background;uniform bool transparent,cold,grainActive;uniform float phase,scale,shear;
float density(vec2 p){float a=bilinear(base,p);return phase>=0.?mix(a,bilinear(high,p),phase):mix(a,bilinear(low,p),-phase);}
vec2 compositionPoint(vec2 p){p=(p-vec2(1200,675))/scale;p.x-=shear*p.y;return p+vec2(1200,675)-.5;}
void main(){vec2 outp=vec2(gl_FragCoord.x,1350.-gl_FragCoord.y);float a=0.;
 if(cold){for(int y=0;y<2;y++)for(int x=0;x<2;x++){
 vec2 p=compositionPoint(outp+vec2(float(x)-.5,float(y)-.5)*.5);
 float d=density(p);ivec2 t=ivec2(floor((p+.5)*2.));bool inside=all(greaterThanEqual(t,ivec2(0)))&&all(lessThan(t,ivec2(4800,2700)));
 a+=grainActive?(inside&&d>0.&&d*65535.>=float(texelFetch(thresholds,clamp(t,ivec2(0),ivec2(4799,2699)),0).r)?1.:0.):d;}a*=.25;
 }else a=density(compositionPoint(outp));
 float n=a>0.&&a<1.?(float(ihash(ivec2(outp)+ivec2(1),0u))/4294967296.-.5)/255.:0.;
 outColor=transparent?vec4(ink,sat(a+n)):vec4(clamp(mix(background,ink,a)+n,0.,1.),1.);}`;

  class FastRenderer {
    constructor(canvas){
      this.canvas=canvas;const gl=canvas.getContext('webgl2',{alpha:true,premultipliedAlpha:false,preserveDrawingBuffer:true,antialias:false});
      if(!gl||!gl.getExtension('EXT_color_buffer_float'))throw new Error('Floating-point graphics are unavailable.');
      this.gl=gl;this.floatLinear=!!gl.getExtension('OES_texture_float_linear');gl.disable(gl.DITHER);this.targets=new Map();this.uploads=new Map();this.geometry={};this.heatKey='';this.coldKey='';this.fieldKey='';this.deformKey='';this.blurKey='';
      const vertex=`#version 300 es\nvoid main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);gl_Position=vec4(p*2.-1.,0.,1.);}`;
      this.programs={};for(const [name,source]of Object.entries({deformField,shape,blurField,gaussian,heatResolve,contract,down,coldResolve,present})){
        const compile=(type,code)=>{const s=gl.createShader(type);gl.shaderSource(s,code);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(s));return s;};
        const p=gl.createProgram();const vs=compile(gl.VERTEX_SHADER,vertex),fs=compile(gl.FRAGMENT_SHADER,source);
        gl.attachShader(p,vs);gl.attachShader(p,fs);gl.linkProgram(p);gl.deleteShader(vs);gl.deleteShader(fs);
        if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(p));this.programs[name]=p;
      }
      this.uniforms=new Map();
    }
    location(name){const key=this.program+'|'+name;if(!this.uniforms.has(key))this.uniforms.set(key,this.gl.getUniformLocation(this.programs[this.program],name));return this.uniforms.get(key);}
    f(name,...value){this.gl['uniform'+value.length+'f'](this.location(name),...value);}
    i(name,value){this.gl.uniform1i(this.location(name),value);}
    u(name,value){this.gl.uniform1ui(this.location(name),value>>>0);}
    bind(name,texture,unit){const g=this.gl;g.activeTexture(g.TEXTURE0+unit);g.bindTexture(g.TEXTURE_2D,texture.texture||texture);this.i(name,unit);}
    target(name,w=W,h=H){
      let t=this.targets.get(name);if(t&&t.width===w&&t.height===h)return t;
      const g=this.gl;if(t){g.deleteTexture(t.texture);g.deleteFramebuffer(t.framebuffer);}
      const texture=g.createTexture();g.bindTexture(g.TEXTURE_2D,texture);g.texParameteri(g.TEXTURE_2D,g.TEXTURE_MIN_FILTER,this.floatLinear?g.LINEAR:g.NEAREST);g.texParameteri(g.TEXTURE_2D,g.TEXTURE_MAG_FILTER,this.floatLinear?g.LINEAR:g.NEAREST);
      g.texParameteri(g.TEXTURE_2D,g.TEXTURE_WRAP_S,g.CLAMP_TO_EDGE);g.texParameteri(g.TEXTURE_2D,g.TEXTURE_WRAP_T,g.CLAMP_TO_EDGE);
      g.texImage2D(g.TEXTURE_2D,0,g.R32F,w,h,0,g.RED,g.FLOAT,null);const framebuffer=g.createFramebuffer();g.bindFramebuffer(g.FRAMEBUFFER,framebuffer);g.framebufferTexture2D(g.FRAMEBUFFER,g.COLOR_ATTACHMENT0,g.TEXTURE_2D,texture,0);
      if(g.checkFramebufferStatus(g.FRAMEBUFFER)!==g.FRAMEBUFFER_COMPLETE)throw new Error('The floating-point target could not be created.');
      t={texture,framebuffer,width:w,height:h};this.targets.set(name,t);return t;
    }
    upload(name,data,w,h,integer=false){
      const g=this.gl;let t=this.uploads.get(name);if(!t){t={texture:g.createTexture(),width:w,height:h};this.uploads.set(name,t);}
      g.bindTexture(g.TEXTURE_2D,t.texture);g.texParameteri(g.TEXTURE_2D,g.TEXTURE_MIN_FILTER,g.NEAREST);g.texParameteri(g.TEXTURE_2D,g.TEXTURE_MAG_FILTER,g.NEAREST);
      g.texParameteri(g.TEXTURE_2D,g.TEXTURE_WRAP_S,g.CLAMP_TO_EDGE);g.texParameteri(g.TEXTURE_2D,g.TEXTURE_WRAP_T,g.CLAMP_TO_EDGE);g.pixelStorei(g.UNPACK_ALIGNMENT,1);
      g.texImage2D(g.TEXTURE_2D,0,integer?g.R16UI:g.R32F,w,h,0,integer?g.RED_INTEGER:g.RED,integer?g.UNSIGNED_SHORT:g.FLOAT,data);return t;
    }
    use(name,target){const g=this.gl;this.program=name;g.useProgram(this.programs[name]);g.bindFramebuffer(g.FRAMEBUFFER,target?.framebuffer||null);g.viewport(0,0,target?.width||W,target?.height||H);}
    draw(){this.gl.drawArrays(this.gl.TRIANGLES,0,3);}
    setGeometry(mode,g,engine){this.geometry[mode]=g;engine.geometry=g;this[mode+'Engine']=engine;
      if(mode==='heat'){this.upload('sdf',g.sdf,W,H);this.heatKey='';this.deformKey='';this.blurKey='';}
      else{this.upload('mask',g.mask,W,H);this.upload('dist',g.dist,W,H);this.coldKey='';this.fieldKey='';}}
    setThresholds(data){this.upload('thresholds',data,4800,2700,true);}
    makeHeatShape(p,blurAnchor=p.blur,drift=null){
      const maps=this.heatEngine.makeMaps(p.seed,p.locations),shapeKey=JSON.stringify([this.geometry.heat.key,p.seed,p.expansion,p.deformations,p.deformationStrength,p.locations?.deform]);
      if(drift)maps.blur=ManaRegions.drift(maps.blur,p.seed,drift.cycle,drift.intensity);
      const deformKey=JSON.stringify([this.geometry.heat.key,p.seed,p.deformations,p.locations?.deform]);
      if(this.deformKey!==deformKey){
        const spots=new Float32Array(80),gains=new Float32Array(40);
        maps.deforms.forEach((s,n)=>{spots.set([s.x,s.y,s.radius,s.angle],n*4);gains.set([s.amount,s.stretch],n*2);});
        const field=this.target('heat-deformation');this.use('deformField',field);
        this.f('seed',p.seed%65536);this.i('count',p.deformations);
        this.gl.uniform4fv(this.location('spots[0]'),spots);this.gl.uniform2fv(this.location('gains[0]'),gains);this.draw();
        this.deformKey=deformKey;
      }
      if(this.heatKey!==shapeKey){
        const base=this.target('heat-level-0');this.use('shape',base);this.bind('sdf',this.uploads.get('sdf'),0);this.bind('deformation',this.targets.get('heat-deformation'),1);
        this.f('seed',p.seed%65536);this.f('expansion',p.expansion);this.f('intensity',p.deformationStrength/100);this.draw();
        let source=base,previousSigma=0;
        for(let l=1;l<SIGMAS.length;l++){
          const sigma=SIGMAS[l],step=2**Math.max(0,Math.floor(Math.log2(Math.max(1,sigma/4))));const w=Math.ceil(W/step),h=Math.ceil(H/step);
          const delta=Math.sqrt(sigma*sigma-previousSigma*previousSigma);
          // Equal-sized passes share their scratch surface rather than keeping
          // a full-resolution temporary texture for every blur level.
          const horizontal=this.target('heat-work-'+w+'x'+source.height,w,source.height),out=this.target('heat-level-'+l,w,h);
          this.gaussian(source,horizontal,delta*source.width/W,[1,0]);this.gaussian(horizontal,out,delta*source.height/H,[0,1]);
          source=out;previousSigma=sigma;
        }
        this.heatKey=shapeKey;
      }
      const blurKey=JSON.stringify([this.geometry.heat.key,p.seed,Math.ceil(blurAnchor/100*12),p.locations?.blur,drift]);
      if(this.blurKey!==blurKey){
        const field=this.target('heat-blur-field');this.use('blurField',field);
        const spots=new Float32Array(48);maps.blur.forEach((s,n)=>spots.set([s.x,s.y,s.radius,s.strength],n*4));
        this.gl.uniform4fv(this.location('spots[0]'),spots);this.i('count',Math.ceil(blurAnchor/100*12));this.f('seed',p.seed%65536);this.draw();this.blurKey=blurKey;
      }
    }
    gaussian(source,target,sigma,axis){
      const radius=Math.min(32,Math.ceil(sigma*3.5)),weights=new Float32Array(33);let total=0;
      for(let i=0;i<=radius;i++){weights[i]=Math.exp(-.5*(i/sigma)**2);total+=weights[i]*(i?2:1);}for(let i=0;i<=radius;i++)weights[i]/=total;
      this.use('gaussian',target);this.bind('source',source,0);this.f('destination',target.width,target.height);this.f('axis',...axis);this.i('radius',radius);this.i('linearSampling',this.floatLinear?1:0);this.gl.uniform1fv(this.location('weights[0]'),weights);this.draw();
    }
    heat(p,name='heat-base',blurAnchor=p.blur,drift=null){
      this.makeHeatShape(p,blurAnchor,drift);const target=this.target(name);this.use('heatResolve',target);
      for(let i=0;i<SIGMAS.length;i++)this.bind('levels['+i+']',this.targets.get('heat-level-'+i),i);
      this.bind('blurMap',this.targets.get('heat-blur-field'),14);this.f('blur',p.blur);this.f('expansion',p.expansion);this.f('expansionBlur',p.expansionBlur);this.draw();return target;
    }
    cold(p,name='cold-base',drift=null){
      const g=this.geometry.cold,engine=this.coldEngine,key=g.key+'|'+p.contraction;
      if(this.coldKey!==key){
        let source=this.target('cold-level-0');this.use('contract',source);this.bind('mask',this.uploads.get('mask'),0);this.bind('dist',this.uploads.get('dist'),1);this.f('erosion',(p.contraction/100)**1.35*g.stroke*.19);this.draw();
        for(let i=1;i<10;i++){
          const w=Math.ceil(source.width/2),h=Math.ceil(source.height/2),temp=this.target('cold-work-'+i,w,source.height),dest=this.target('cold-level-'+i,w,h);
          this.use('down',temp);this.bind('source',source,0);this.f('axis',1,0);this.draw();
          this.use('down',dest);this.bind('source',temp,0);this.f('axis',0,1);this.draw();source=dest;
        }this.coldKey=key;
      }
      const fieldKey=JSON.stringify([g.key,p.seed,p.regions,p.locations?.dissolution,drift]);
      if(this.fieldKey!==fieldKey){
        let sites=engine.makeSites(p.seed,p.regions,p.locations?.dissolution);
        if(drift)sites=ManaRegions.drift(sites,p.seed,drift.cycle,drift.intensity);
        sites=sites.map(s=>({...s,c:Math.cos(s.angle),sn:Math.sin(s.angle)}));
        const gw=241,gh=136,field=new Float32Array(gw*gh),warpKey=g.key+'|'+p.seed;
        if(this.warpKey!==warpKey){
          this.warp=new Float32Array(gw*gh*2);
          for(let y=0;y<gh;y++)for(let x=0;x<gw;x++){
            const px=x*10,py=y*10,k=(y*gw+x)*2;
            this.warp[k]=px+(ManaCold.noise(px/125,py/125,p.seed+11)-.5)*g.size*.1;
            this.warp[k+1]=py+(ManaCold.noise(px/135,py/135,p.seed+23)-.5)*g.size*.1;
          }this.warpKey=warpKey;
        }
        for(let y=0;y<gh;y++)for(let x=0;x<gw;x++){
          const k=(y*gw+x)*2,wx=this.warp[k],wy=this.warp[k+1];
          let hot=0;for(const s of sites){const dx=wx-s.x,dy=wy-s.y,u=(dx*s.c+dy*s.sn)/s.rx,v=(-dx*s.sn+dy*s.c)/s.ry;hot+=Math.exp(-2.8*(u*u+v*v))*s.gain;}
          field[y*gw+x]=Math.min(1,hot);
        }this.upload('cold-field',field,gw,gh);this.fieldKey=fieldKey;
      }
      const dest=this.target(name);this.use('coldResolve',dest);for(let i=0;i<10;i++)this.bind('levels['+i+']',this.targets.get('cold-level-'+i),i);
      this.bind('field',this.uploads.get('cold-field'),10);this.u('seed',p.seed);this.f('strength',p.intensity/100);this.f('spread',p.spread/100);this.f('fade',p.fade/100);this.f('stroke',g.stroke);this.i('effectActive',p.regions>0&&(p.intensity>0||p.fade>0)?1:0);this.draw();return dest;
    }
    frame(mode,s,cycle=0,enabled=true){
      const motion=ManaRegions.motion(s,cycle,enabled);
      this.compose(mode,s,motion.phase,motion.breathing,motion);
    }
    compose(mode,s,phase=0,breathing=false,motion={}){
      let base=this.targets.get(mode+'-base');if(!base)return;
      if(mode==='heat'&&((breathing&&phase!==0)||motion.drift)){
        // Animate one contour before convolution. Blending differently-sized
        // alpha images makes two visible silhouettes at intermediate phases.
        const p=ManaBeta.breatheParams('heat',s.params,phase,ManaBeta.MAX_BREATH_AMPLITUDE);
        base=this.heat(p,'heat-live',s.params.blur,motion.drift);
      }
      if(mode==='cold'&&motion.drift){
        const p=ManaBeta.breatheParams('cold',s.params,breathing?phase:0,ManaBeta.MAX_BREATH_AMPLITUDE);
        base=this.cold(p,'cold-live',motion.drift);
      }
      const mixCold=mode==='cold'&&breathing&&!motion.drift;
      // Creating a texture changes the active binding. Allocate the integer
      // fallback before binding the three floating-point density samplers.
      if(!this.uploads.has('thresholds'))this.upload('thresholds',new Uint16Array(4),2,2,true);
      this.use('present',null);this.bind('base',base,0);this.bind('low',mixCold?this.targets.get(mode+'-low'):base,1);this.bind('high',mixCold?this.targets.get(mode+'-high'):base,2);
      this.bind('thresholds',this.uploads.get('thresholds'),3);
      const rgb=hex=>[1,3,5].map(k=>parseInt(hex.slice(k,k+2),16)/255);
      this.f('ink',...rgb(s.typeColor));this.f('background',...rgb(s.background||'#000000'));this.i('transparent',s.background===null?1:0);
      this.i('cold',mode==='cold'?1:0);this.i('grainActive',s.params.regions>0&&(s.params.intensity>0||s.params.fade>0)?1:0);this.f('phase',mixCold?phase:0);this.f('scale',s.size/100);this.f('shear',motion.shear||0);this.draw();
    }
    completed(){
      // Keep a single render in flight. Waiting asynchronously allows pointer,
      // keyboard and cancellation events to replace obsolete slider values.
      const g=this.gl,sync=g.fenceSync(g.SYNC_GPU_COMMANDS_COMPLETE,0);g.flush();
      return new Promise((resolve,reject)=>{
        const poll=()=>{
          if(g.isContextLost()){g.deleteSync(sync);reject(new Error('Graphics context lost. Reload to restore the preview.'));return;}
          const result=g.clientWaitSync(sync,0,0);
          if(result===g.TIMEOUT_EXPIRED){setTimeout(poll,8);return;}
          g.deleteSync(sync);result===g.WAIT_FAILED?reject(new Error('Graphics processing failed.')):resolve();
        };poll();
      });
    }
    read(name){const t=this.targets.get(name),out=new Float32Array(t.width*t.height);const g=this.gl;g.bindFramebuffer(g.FRAMEBUFFER,t.framebuffer);g.readPixels(0,0,t.width,t.height,g.RED,g.FLOAT,out);return out;}
    dispose(){const g=this.gl;for(const t of this.targets.values()){g.deleteTexture(t.texture);g.deleteFramebuffer(t.framebuffer);}for(const t of this.uploads.values())g.deleteTexture(t.texture);for(const p of Object.values(this.programs))g.deleteProgram(p);}
  }
  globalThis.ManaFast={FastRenderer,SIGMAS};
})();
