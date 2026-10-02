(() => {
  'use strict';
  const $=id=>document.getElementById(id), state=ManaBeta.createState();
  const t=(key,values)=>ManaI18n.t(key,values);
  const clone=value=>JSON.parse(JSON.stringify(value));
  const withTimeout=(promise,ms,message)=>new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error(message)),ms);
    promise.then(value=>{clearTimeout(timer);resolve(value);},error=>{clearTimeout(timer);reject(error);});
  });
  const PALETTE=['#1A1A1A','#DAC4A3','#E6AE5E','#B8C2A9','#C08040','#F5EEE4','#C93200','#555488'];
  const createCanvas=(w,h)=>{const c=document.createElement('canvas');c.width=w;c.height=h;return c;};
  const engines={heat:new ManaHeat.HeatEngine(createCanvas),cold:new ManaCold.ColdEngine(createCanvas)};
  const controls={heat:{expansion:'expansion',expansionBlur:'expansionBlur',deformations:'heatDeformations',deformationStrength:'heatStrength',blur:'heatBlur'},
    cold:{contraction:'contraction',spread:'fragmentSpread',regions:'deformations',intensity:'deformationStrength',fade:'grainFade',grain:'frost'}};
  const current=()=>state[state.mode], nextFrame=()=>new Promise(requestAnimationFrame);
  const resultKeys={heat:'',cold:''}, breathingKeys={heat:'',cold:''}, geometryKeys={heat:'',cold:''}, cpuResults={heat:null,cold:null};
  let output=$('output'),gpu=null,ctx=null,ready=false,running=false,revision=0,queued=0,animation=0,epoch=0,lastFrame=0,cycle=0,thresholdKey='';
  let cpuColored=null,cpuColoredResult=null,cpuColor='',loopToken=0,loopSeconds=6,exportJob=null,graphicsLost=false;
  let exportMode='static',editing=null,drag=null;
  let statusNotice={key:'loadingFonts'},exportNotice=null,lastRenderError=null;
  const motionNames=['breathing','sway','drift'];
  const locationButtons={blur:'locateBlur',deform:'locateDeform',dissolution:'locateDissolution'};
  const wantsMotion=()=>exportMode==='video'&&motionNames.some(name=>current()[name]);
  const animationReady=()=>!current().breathing||breathingKeys[state.mode]===resultKeys[state.mode];

  class Preparer {
    constructor(){
      this.cache=new Map();this.pending=new Map();this.id=0;this.worker=null;this.url=null;this.startupTimer=null;
      this.started=new Promise((resolve,reject)=>{this.resolveStarted=resolve;this.rejectStarted=reject;});
      // The worker can fail before the first call awaits its startup promise.
      this.started.catch(()=>{});
      try{
        const source=globalThis.ManaAssets?.workerSource||$('workerSource')?.textContent;
        if(!source)throw new Error('Worker source unavailable.');
        this.url=URL.createObjectURL(new Blob([source],{type:'text/javascript'}));
        this.worker=new Worker(this.url);
        this.worker.onmessage=({data:m})=>{
          if(m.kind==='ready'){
            clearTimeout(this.startupTimer);this.resolveStarted();
            if(this.url){URL.revokeObjectURL(this.url);this.url=null;}return;
          }
          const p=this.pending.get(m.id);if(p){clearTimeout(p.timer);this.pending.delete(m.id);m.error?p.reject(new Error(m.error)):p.resolve(m);}
        };
        this.worker.onerror=event=>{event.preventDefault?.();this.disable();};
        this.worker.onmessageerror=()=>this.disable();
        this.startupTimer=setTimeout(()=>this.disable(),8000);
      }catch{this.disable();}
    }
    disable(){
      clearTimeout(this.startupTimer);this.worker?.terminate();this.worker=null;this.rejectStarted(new Error('WORKER_UNAVAILABLE'));
      if(this.url){URL.revokeObjectURL(this.url);this.url=null;}
      for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(new Error('WORKER_UNAVAILABLE'));}this.pending.clear();
    }
    async call(payload){
      await this.started;if(!this.worker)throw new Error('WORKER_UNAVAILABLE');
      return new Promise((resolve,reject)=>{
        const id=++this.id,timer=setTimeout(()=>this.disable(),30000);this.pending.set(id,{resolve,reject,timer});
        try{this.worker.postMessage({...payload,id});}catch(e){clearTimeout(timer);this.pending.delete(id);reject(e);}
      });
    }
    cancel(){
      if(!this.worker||!this.pending.size)return;
      this.worker.postMessage({kind:'cancel',id:++this.id});
      for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(new Error('CANCELLED'));}this.pending.clear();
    }
    fontSource(family){
      const source=globalThis.ManaAssets?.fontSources?.[family];if(source)return source;
      for(const sheet of document.styleSheets){
        let rules;try{rules=sheet.cssRules;}catch{continue;}
        for(const r of rules)if(r.style?.getPropertyValue('font-family').replaceAll('"','').replaceAll("'",'')===family)return r.style.getPropertyValue('src');
      }
      throw new Error('Embedded font unavailable.');
    }
    async geometry(mode,s,isCurrent){
      const text=s.text.replace(/\s+/g,' ').trim(),key=mode+'|'+text+'|'+s.font;
      if(this.cache.has(key))return this.cache.get(key);
      let g;
      if(this.worker){
        try{g=(await this.call({kind:'geometry',mode,text,family:s.font,fontSource:this.fontSource(s.font)})).geometry;}
        catch(e){if(/CANCELLED/.test(e.message))throw e;this.disable();}
      }
      if(!g){await withTimeout(document.fonts.load(ManaCold.fontSpec(s.font,100)),15000,'Font loading timed out. Reload this page.');await engines[mode].setText(text,s.font,isCurrent);g=engines[mode].geometry;}
      if(!isCurrent())throw new Error('CANCELLED');
      this.cache.set(key,g);if(this.cache.size>3)this.cache.delete(this.cache.keys().next().value);return g;
    }
    async thresholds(p,isCurrent){
      if(this.worker){try{return (await this.call({kind:'threshold',seed:p.seed,grain:p.grain})).thresholds;}
        catch(e){if(/CANCELLED/.test(e.message))throw e;this.disable();}}
      await engines.cold.buildThreshold(p.seed,p.grain,isCurrent);return engines.cold.thresholds;
    }
  }
  const prepare=new Preparer();
  function validResult(){return resultKeys[state.mode]===ManaBeta.renderKey(current());}
  function status(key,values){statusNotice={key,values};$('status').textContent=t(key,values);$('workspace').dataset.status=key;}
  function exportMessage(key,values={}){
    exportNotice={key,values};
    $('exportMessage').textContent=t(key,values.error?{...values,error:ManaI18n.error(values.error)}:values);
  }
  function refresh(){
    $('download').disabled=!validResult()||!current().text.trim()||!!exportJob||graphicsLost;
    const canExport=!!gpu&&validResult()&&current().text.trim()&&animationReady()&&!exportJob&&!graphicsLost;
    $('downloadMOV').disabled=!canExport;$('downloadGIF').disabled=!canExport;
    if(graphicsLost){status('graphicsPaused');return;}
    if(exportJob)return;
    if(!current().text.trim())status('enterText');
    else if(validResult())status(editing?'positioning':wantsMotion()&&animationReady()?'playing':'ready');
    for(const id of Object.values(locationButtons))$(id).disabled=!validResult()||!current().text.trim()||!!exportJob;
  }
  function stopAnimation(){cancelAnimationFrame(animation);animation=0;cycle=0;loopToken++;}
  function compose(){
    if(graphicsLost)return;
    if(!current().text.trim()){
      const color=current().background;
      if(gpu){const g=gpu.gl,rgb=color?[1,3,5].map(k=>parseInt(color.slice(k,k+2),16)/255):[0,0,0];g.bindFramebuffer(g.FRAMEBUFFER,null);g.clearColor(...rgb,color?1:0);g.clear(g.COLOR_BUFFER_BIT);}
      else{ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,2400,1350);if(color){ctx.fillStyle=color;ctx.fillRect(0,0,2400,1350);}}
      return;
    }
    if(gpu){gpu.frame(state.mode,current(),cycle,wantsMotion()&&animationReady()&&!editing);return;}
    const s=current(),result=cpuResults[state.mode];
    if(state.mode==='heat'){ManaHeat.paint(ctx,result,s);return;}
    ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,2400,1350);
    if(s.background){ctx.fillStyle=s.background;ctx.fillRect(0,0,2400,1350);}if(!result)return;
    if(cpuColoredResult!==result||cpuColor!==s.typeColor){
      if(!cpuColored)cpuColored=createCanvas(result.canvas.width,result.canvas.height);
      cpuColored.width=result.canvas.width;cpuColored.height=result.canvas.height;const c=cpuColored.getContext('2d');c.drawImage(result.canvas,0,0);
      c.globalCompositeOperation='source-in';c.fillStyle=s.typeColor;c.fillRect(0,0,cpuColored.width,cpuColored.height);c.globalCompositeOperation='source-over';cpuColoredResult=result;cpuColor=s.typeColor;
    }
    ctx.imageSmoothingQuality='high';ctx.save();ctx.translate(1200,675);ctx.scale(s.size/100,s.size/100);ctx.drawImage(cpuColored,-1200,-675,2400,1350);ctx.restore();
  }
  async function tick(now){
    if(!wantsMotion()||editing||document.hidden||!validResult()||exportJob||graphicsLost){animation=0;return;}
    const token=loopToken;
    if(now-lastFrame>=1000/30){
      cycle=((now-epoch)/(loopSeconds*1000))%1;compose();lastFrame=now;
      try{await gpu.completed();}catch(e){stopAnimation();showError(e);return;}
    }
    if(token===loopToken)animation=requestAnimationFrame(tick);
  }
  function startAnimation(){stopAnimation();epoch=performance.now();lastFrame=0;if(wantsMotion()&&!editing&&animationReady()&&gpu&&!document.hidden&&!exportJob&&!graphicsLost)animation=requestAnimationFrame(tick);}
  function showError(e){lastRenderError=e;$('error').textContent=ManaI18n.error(e);$('error').style.display='block';status('renderError');$('download').disabled=true;$('downloadMOV').disabled=true;$('downloadGIF').disabled=true;}
  function requestRender(preserveLocation=false){
    if(!preserveLocation)exitRegionEdit(false);
    revision++;prepare.cancel();stopAnimation();cancelAnimationFrame(queued);$('error').style.display='none';lastRenderError=null;
    $('download').disabled=true;$('downloadMOV').disabled=true;$('downloadGIF').disabled=true;
    for(const id of Object.values(locationButtons))$(id).disabled=true;
    status(editing?'positioningBusy':'rendering');queued=requestAnimationFrame(run);
  }
  async function run(){
    queued=0;if(!ready||running)return;
    running=true;const job=revision,mode=state.mode,s=clone(current()),key=ManaBeta.renderKey(s),isCurrent=()=>revision===job&&mode===state.mode;
    const started=performance.now();
    try{
      if(!s.text.trim()){
        if(!gpu)cpuResults[mode]=null;compose();
        resultKeys[mode]='';refresh();return;
      }
      if(resultKeys[mode]!==key){
        status('rendering');const geometryKey=s.text.replace(/\s+/g,' ').trim()+'\u0000'+s.font;
        if(geometryKeys[mode]!==geometryKey){
          status('preparingType');const g=await prepare.geometry(mode,s,isCurrent);if(!isCurrent())return;
          if(gpu)gpu.setGeometry(mode,g,engines[mode]);else engines[mode].geometry=g;
          geometryKeys[mode]=geometryKey;
        }
        if(mode==='cold'&&thresholdKey!==s.params.seed+'|'+s.params.grain){
          status('preparingGrain');const thresholds=await prepare.thresholds(s.params,isCurrent);if(!isCurrent())return;
          if(gpu)gpu.setThresholds(thresholds);else{engines.cold.thresholds=thresholds;engines.cold.thresholdKey=s.params.seed+':'+s.params.grain;}
          thresholdKey=s.params.seed+'|'+s.params.grain;
        }
        if(gpu)gpu[mode](s.params,mode+'-base');
        else{
          const r=await engines[mode].render(s.params,isCurrent);if(!isCurrent()){if(r.canvas)r.canvas.width=1;return;}
          if(cpuResults[mode]?.canvas)cpuResults[mode].canvas.width=1;cpuResults[mode]=r;
        }
        resultKeys[mode]=key;cycle=0;compose();
        if(gpu)await gpu.completed();if(!isCurrent())return;refresh();
        console.info(`Mana ${mode}: parameter render ${Math.round(performance.now()-started)} ms`);
      }
      if(s.breathing&&gpu&&exportMode==='video'&&!editing){
        if(breathingKeys[mode]!==key){
          if(mode==='cold'){
            status('preparingBreathing');await nextFrame();if(!isCurrent())return;
            // Cold thresholds a continuous density field into solid fragments.
            // Heat instead renders a single changing contour before its blur.
            gpu.cold(ManaBeta.breatheParams(mode,s.params,-1,ManaBeta.MAX_BREATH_AMPLITUDE),mode+'-low');
            await gpu.completed();if(!isCurrent())return;
            gpu.cold(ManaBeta.breatheParams(mode,s.params,1,ManaBeta.MAX_BREATH_AMPLITUDE),mode+'-high');await gpu.completed();if(!isCurrent())return;
          }
          breathingKeys[mode]=key;
        }
      }
      if(isCurrent()){cycle=0;compose();startAnimation();refresh();}
    }catch(e){if(!/CANCELLED/.test(e.message)&&isCurrent()){console.error(e);showError(e);}}
    finally{running=false;if(!isCurrent())queued=requestAnimationFrame(run);}
  }
  function regionSites(){
    const p=current().params,engine=engines[state.mode];
    if(!engine.geometry)return [];
    if(editing==='dissolution')return engine.makeSites(p.seed,p.regions,p.locations?.dissolution);
    const maps=engine.makeMaps(p.seed,p.locations);
    return editing==='blur'?maps.blur.slice(0,Math.ceil(p.blur/100*12)):maps.deforms.slice(0,p.deformations);
  }
  function drawRegion(group,site){
    const k=current().size/100,p=ManaRegions.toStage(site,current().size);
    group.setAttribute('transform',`translate(${p.x} ${p.y}) rotate(${(site.angle||0)*180/Math.PI})`);
    const rx=(site.rx||site.radius)*k,ry=(site.ry||site.radius/(site.stretch||1))*k;
    for(const ellipse of group.children){
      if(ellipse.tagName.toLowerCase()==='ellipse'){ellipse.setAttribute('rx',rx);ellipse.setAttribute('ry',ry);}
    }
  }
  function exitRegionEdit(resume=true){
    if(!editing)return false;
    editing=null;drag=null;$('regionOverlay').setAttribute('hidden','');$('regionToolbar').hidden=true;
    for(const id of Object.values(locationButtons))$(id).setAttribute('aria-pressed','false');
    if(resume)requestRender();return true;
  }
  function compositionChanged(){
    if(exitRegionEdit(false))requestRender();else compose();
  }
  function localizeRegions(){
    if(!editing)return;
    const groups=Array.from($('regionOverlay').children);
    $('regionHint').textContent=groups.length?t('regionHint',{count:groups.length}):t('noRegions');
    for(const g of groups)g.setAttribute('aria-label',t('regionLabel',{kind:t('kind_'+editing),index:+g.dataset.region+1}));
  }
  function enterRegionEdit(kind){
    if(exportJob||!validResult()||!current().text.trim())return;
    if(editing===kind){exitRegionEdit();return;}
    stopAnimation();editing=kind;drag=null;compose();
    const overlay=$('regionOverlay'),sites=regionSites();overlay.replaceChildren();overlay.removeAttribute('hidden');$('regionToolbar').hidden=false;
    for(const [key,id]of Object.entries(locationButtons))$(id).setAttribute('aria-pressed',String(key===kind));
    const svg=(tag,attributes)=>{const e=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [k,v]of Object.entries(attributes))e.setAttribute(k,String(v));return e;};
    sites.forEach((site,index)=>{
      const g=svg('g',{tabindex:0,role:'button'});
      g.dataset.region=String(index);
      // Two concentric strokes remain legible on every palette colour and on
      // both the ink and checkerboard, without tinting the actual effect.
      g.appendChild(svg('ellipse',{cx:0,cy:0,fill:'none',stroke:'#000','stroke-width':4.5,'vector-effect':'non-scaling-stroke','pointer-events':'all'}));
      g.appendChild(svg('ellipse',{cx:0,cy:0,fill:'none',stroke:'#fff','stroke-width':1.8,'vector-effect':'non-scaling-stroke','pointer-events':'none',class:'region-light'}));
      g.addEventListener('pointerdown',event=>{
        if((event.button!==undefined&&event.button!==0)||drag)return;
        event.preventDefault();g.focus();
        drag={index,pointer:event.pointerId,start:pointerPoint(event),site:regionSites()[index]};
        overlay.setPointerCapture(event.pointerId);
        overlay.appendChild(g); // The selected outline stays visible in overlaps.
      });
      g.addEventListener('keydown',event=>{
        const delta={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]}[event.key];
        if(!delta)return;event.preventDefault();const s=regionSites()[index],step=(event.shiftKey?20:5)/(current().size/100);
        moveRegion(index,s.x+delta[0]*step,s.y+delta[1]*step);
      });
      overlay.appendChild(g);drawRegion(g,site);
    });localizeRegions();refresh();
  }
  function pointerPoint(event){
    const rect=$('regionOverlay').getBoundingClientRect();
    return ManaRegions.fromStage({x:(event.clientX-rect.left)/rect.width*2400,y:(event.clientY-rect.top)/rect.height*1350},current().size);
  }
  function moveRegion(index,x,y){
    if(!editing)return;
    const locations=current().params.locations||(current().params.locations={});
    (locations[editing]||=[])[index]={x:ManaRegions.clamp(x/2400),y:ManaRegions.clamp(y/1350)};
    const site=regionSites()[index];
    const group=Array.from($('regionOverlay').children).find(g=>+g.dataset.region===index);
    if(group&&site)drawRegion(group,site);
    requestRender(true);
  }
  function setupRegionEditor(){
    for(const [kind,id]of Object.entries(locationButtons))$(id).addEventListener('click',()=>enterRegionEdit(kind));
    $('finishLocation').addEventListener('click',()=>exitRegionEdit());
    $('advancedControls').addEventListener('toggle',()=>{if(!$('advancedControls').open)exitRegionEdit();});
    document.addEventListener('keydown',event=>{if(event.key==='Escape'&&editing){event.preventDefault();exitRegionEdit();}});
    const overlay=$('regionOverlay');
    overlay.addEventListener('pointermove',event=>{
      if(!drag||event.pointerId!==drag.pointer)return;
      const p=pointerPoint(event);moveRegion(drag.index,drag.site.x+p.x-drag.start.x,drag.site.y+p.y-drag.start.y);
    });
    const end=event=>{if(drag&&event.pointerId===drag.pointer){drag=null;if(overlay.hasPointerCapture(event.pointerId))overlay.releasePointerCapture(event.pointerId);}};
    overlay.addEventListener('pointerup',end);overlay.addEventListener('pointercancel',end);overlay.addEventListener('lostpointercapture',end);
  }
  function sync(){
    const s=current();$('textInput').value=s.text;$('fontSelect').value=s.font;$('fontSize').value=s.size;$('fontSizeValue').textContent=s.size+'%';
    for(const name of motionNames){
      $(name).checked=s[name];$(name).disabled=!gpu;
      $(name+'Intensity').value=s[name+'Intensity'];$(name+'IntensityValue').textContent=s[name+'Intensity']+'%';$(name+'Intensity').disabled=!s[name]||!gpu;
    }
    for(const type of ['static','video']){$(type+'Mode').setAttribute('aria-pressed',String(type===exportMode));$(type+'Export').hidden=type!==exportMode;}
    $('driftHint').textContent=t(state.mode==='heat'?'driftHeat':'driftCold');
    for(const mode of ['heat','cold']){
      $(mode+'Mode').setAttribute('aria-pressed',String(mode===state.mode));$(mode+'Controls').hidden=mode!==state.mode;
      for(const [key,id]of Object.entries(controls[mode])){$(id).value=state[mode].params[key];$(id+'Value').textContent=state[mode].params[key];}
    }
    for(const [id,value]of [['typePalette',s.typeColor],['backgroundPalette',s.background]])for(const b of $(id).children){
      b.setAttribute('aria-pressed',String(b.dataset.color===(value||'')));
      b.title=b.dataset.color?t('color_'+b.dataset.color.slice(1))+' · '+b.dataset.color:t('transparent');b.setAttribute('aria-label',b.title);
    }
    const mode=state.mode==='heat'?'Heat':'Cold';document.body.dataset.mode=state.mode;
    $('typeHex').textContent=s.typeColor;$('backgroundHex').textContent=s.background||t('transparent');output.setAttribute('aria-label',t('previewLabel',{mode}));
    $('previewMode').textContent=mode;$('previewKind').textContent=t(exportMode==='video'?'videoPreview':'staticPreview');
    $('motionHint').textContent=gpu?t('loopSummary',{seconds:loopSeconds}):t('graphicsNeeded');
    ManaUI.update();
  }
  function palette(id,transparent,onChange){
    for(const color of transparent?[null,...PALETTE]:PALETTE){
      const b=document.createElement('button');b.type='button';b.className='swatch'+(color?'':' transparent-swatch');b.dataset.color=color||'';
      if(color){b.style.backgroundColor=color;const [r,g,blue]=[1,3,5].map(k=>parseInt(color.slice(k,k+2),16));b.style.setProperty('--check-ink',r*.299+g*.587+blue*.114>155?'#26251f':'#faf7f0');}
      b.addEventListener('click',()=>{onChange(color);sync();compositionChanged();});$(id).appendChild(b);
    }
  }
  function downloadBlob(blob,name){
    const a=document.createElement('a'),url=URL.createObjectURL(blob);a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
  }
  function normalizeDuration(){
    const value=Number($('loopDuration').value);loopSeconds=Number.isFinite(value)&&value>0?Math.max(1,Math.min(30,Math.round(value*2)/2)):6;
    $('loopDuration').value=loopSeconds;
    if(gpu)$('motionHint').textContent=t('loopSummary',{seconds:loopSeconds});
    return loopSeconds;
  }
  async function exportLoop(format){
    if(exportJob||!gpu||graphicsLost||!validResult()||!current().text.trim()||!animationReady())return;
    exitRegionEdit(false);
    const seconds=normalizeDuration(),width=[960,1200,2400].includes(+$('exportSize').value)?+$('exportSize').value:1200,height=width*9/16;
    const fps=format==='mov'?24:20,count=Math.round(seconds*fps),mode=state.mode,s=clone(current()),job={cancelled:false};
    exportJob=job;stopAnimation();$('editorFields').disabled=true;$('exportProgress').hidden=false;$('exportCancel').hidden=false;
    $('exportMeter').value=0;$('exportMeter').max=count;exportMessage('preparingLoop');refresh();
    const snapshot=createCanvas(width,height),context=snapshot.getContext('2d',{willReadFrequently:format==='gif'});
    context.imageSmoothingEnabled=true;context.imageSmoothingQuality='high';
    const check=()=>{if(job.cancelled)throw new Error('EXPORT_CANCELLED');};
    try{
      const encoder=format==='mov'?new ManaExport.MOVEncoder(width,height,seconds,count):new ManaExport.GIFEncoder(width,height,s.typeColor,s.background,seconds,count);
      await gpu.completed();check();
      for(let i=0;i<count;i++){
        // Sample one whole cycle at fixed timestamps, excluding the repeated
        // end point. Slow rendering changes export time, never movie timing.
        gpu.frame(mode,s,i/count,true);await gpu.completed();check();
        context.clearRect(0,0,width,height);context.drawImage(output,0,0,width,height);
        if(format==='mov'){
          const blob=await new Promise((resolve,reject)=>snapshot.toBlob(b=>b?resolve(b):reject(new Error('PNG video frame failed.')),'image/png'));
          check();encoder.add(blob);
        }else encoder.add(context.getImageData(0,0,width,height).data);
        $('exportMeter').value=i+1;exportMessage('exportProgress',{format:format.toUpperCase(),percent:Math.round((i+1)/count*100),frame:i+1,count});
        status('exporting',{format:format.toUpperCase()});await new Promise(resolve=>setTimeout(resolve,0));check();
      }
      const blob=encoder.finish();check();downloadBlob(blob,`mana-${mode}-${seconds}s.${format}`);
      exportMessage('exportReady',{format:format.toUpperCase(),seconds,width,height});
    }catch(e){
      exportMessage(e.message==='EXPORT_CANCELLED'?'exportCancelled':'exportFailed',{error:e});
      if(e.message!=='EXPORT_CANCELLED')console.error(e);
    }finally{
      snapshot.width=1;exportJob=null;$('editorFields').disabled=false;$('exportCancel').hidden=true;
      cycle=0;compose();startAnimation();refresh();
    }
  }
  async function initialize(){
    try{gpu=new ManaFast.FastRenderer(output);}
    catch(e){
      console.warn('Graphics fallback:',e.message);const replacement=output.cloneNode();output.replaceWith(replacement);output=replacement;ctx=output.getContext('2d');
      for(const name of motionNames)$(name).disabled=true;
      $('motionHint').textContent=t('graphicsNeeded');
    }
    for(const option of $('fontSelect').options){const m=option.value.match(/^Season(Mix|Sans|Serif)(.*)$/);option.textContent=`Season ${m[1]} · ${m[2].replace('Italic',' Italic')}`;}
    for(const mode of ['heat','cold']){
      $(mode+'Mode').addEventListener('click',()=>{if(state.mode!==mode){stopAnimation();state.mode=mode;sync();compose();requestRender();}});
      for(const [key,id]of Object.entries(controls[mode]))$(id).addEventListener('input',()=>{state[mode].params[key]=+$(id).value;$(id+'Value').textContent=$(id).value;requestRender();});
    }
    $('textInput').addEventListener('input',()=>{current().text=$('textInput').value;requestRender();});
    $('fontSelect').addEventListener('change',()=>{current().font=$('fontSelect').value;requestRender();});
    $('fontSize').addEventListener('input',()=>{current().size=+$('fontSize').value;$('fontSizeValue').textContent=current().size+'%';compositionChanged();});
    for(const name of motionNames){
      $(name).addEventListener('change',()=>{current()[name]=$(name).checked;sync();requestRender();});
      $(name+'Intensity').addEventListener('input',()=>{current()[name+'Intensity']=+$(name+'Intensity').value;$(name+'IntensityValue').textContent=current()[name+'Intensity']+'%';compositionChanged();});
    }
    for(const type of ['static','video'])$(type+'Mode').addEventListener('click',()=>{exportMode=type;stopAnimation();sync();requestRender();});
    $('loopDuration').addEventListener('change',()=>{normalizeDuration();compositionChanged();startAnimation();});
    $('exportSize').addEventListener('change',()=>compositionChanged());
    $('downloadMOV').addEventListener('click',()=>exportLoop('mov'));
    $('downloadGIF').addEventListener('click',()=>exportLoop('gif'));
    $('exportCancel').addEventListener('click',()=>{if(exportJob){exportJob.cancelled=true;exportMessage('cancelling');}});
    document.addEventListener('visibilitychange',()=>{if(exportJob)return;if(document.hidden)stopAnimation();else if(validResult()&&animationReady())startAnimation();});
    palette('typePalette',false,color=>current().typeColor=color);palette('backgroundPalette',true,color=>current().background=color);
    $('randomize').addEventListener('click',()=>{const a=new Uint32Array(1);crypto.getRandomValues(a);current().params.seed=a[0];current().params.locations={};requestRender();});
    $('download').addEventListener('click',()=>{
      if(!validResult()||!current().text.trim())return;
      exitRegionEdit(false);stopAnimation();compose();const snapshot=createCanvas(2400,1350);snapshot.getContext('2d').drawImage(output,0,0);const mode=state.mode;
      snapshot.toBlob(blob=>{snapshot.width=1;if(!blob){showError(new Error('PNG export failed.'));return;}
        downloadBlob(blob,`mana-${mode}.png`);},'image/png');
    });
    output.addEventListener('webglcontextlost',event=>{event.preventDefault();graphicsLost=true;stopAnimation();if(exportJob)exportJob.cancelled=true;refresh();});
    window.addEventListener('mana:language',()=>{
      sync();localizeRegions();status(statusNotice.key,statusNotice.values);
      if(exportNotice)exportMessage(exportNotice.key,exportNotice.values);
      if(lastRenderError)$('error').textContent=ManaI18n.error(lastRenderError);
    });
    setupRegionEditor();ManaUI.init();sync();
    try{
      const image=new Image();await withTimeout(new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=()=>reject(new Error('Texture unavailable. Extract the complete ZIP and open index.html.'));image.src=globalThis.ManaAssets?.textureSrc||'data:image/png;base64,';}),15000,'Texture loading timed out. Reload this page.');
      const c=createCanvas(image.naturalWidth,image.naturalHeight),x=c.getContext('2d',{willReadFrequently:true});x.drawImage(image,0,0);const rgba=x.getImageData(0,0,c.width,c.height).data,data=new Uint8Array(c.width*c.height);
      for(let i=0;i<data.length;i++)data[i]=rgba[i*4];engines.cold.setTexture(data,c.width,c.height);
      if(prepare.worker){try{await prepare.call({kind:'texture',data,width:c.width,height:c.height});}catch{prepare.disable();}}
      c.width=1;ready=true;requestRender();
    }catch(e){showError(e);}
    window.addEventListener('pagehide',()=>{if(exportJob)exportJob.cancelled=true;stopAnimation();prepare.disable();});
  }
  initialize().catch(showError);
})();
