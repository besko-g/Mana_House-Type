/* Presentation only. Effects keep their canonical, fixed-resolution canvas. */
(() => {
  'use strict';
  function updateRange(input){
    const lo=Number(input.min)||0,hi=Number(input.max)||100;
    input.style.setProperty('--fill',Math.max(0,Math.min(100,(Number(input.value)-lo)/(hi-lo)*100))+'%');
  }
  function update(){
    for(const input of document.querySelectorAll('input[type="range"]'))updateRange(input);
    for(const name of ['breathing','sway','drift']){
      const group=document.getElementById(name+'Amount');if(group)group.hidden=!document.getElementById(name).checked;
    }
  }
  function init(){
    ManaI18n.apply();
    for(const code of ['pt','en'])document.getElementById('language'+code.toUpperCase()).addEventListener('click',()=>ManaI18n.setLanguage(code));
    document.addEventListener('input',event=>{if(event.target?.type==='range')updateRange(event.target);});
    const host=document.getElementById('canvasSpace'),stage=document.getElementById('stage');
    const fit=()=>{
      const rect=host.getBoundingClientRect(),width=Math.max(1,Math.min(rect.width,rect.height*16/9));
      stage.style.width=width+'px';stage.style.height=width*9/16+'px';
    };
    let observer;
    if(typeof ResizeObserver==='function'){observer=new ResizeObserver(fit);observer.observe(host);}
    window.addEventListener('resize',fit);window.addEventListener('pagehide',()=>observer?.disconnect());
    fit();update();
  }
  globalThis.ManaUI={init,update};
})();
