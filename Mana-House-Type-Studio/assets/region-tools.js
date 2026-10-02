/* Canonical coordinates shared by rendering, region editing and loop export. */
(() => {
  'use strict';
  const W=2400,H=1350,TAU=Math.PI*2;
  const clamp=(n,a=0,b=1)=>Math.max(a,Math.min(b,n));
  function place(sites,locations=[],width=W,height=H){
    return sites.map((site,i)=>{
      const p=locations?.[i];
      return p&&Number.isFinite(p.x)&&Number.isFinite(p.y)?{...site,x:p.x*width,y:p.y*height}:{...site};
    });
  }
  function drift(sites,seed,cycle,intensity){
    const t=((cycle%1)+1)%1,theta=t*TAU,amount=clamp(intensity/100);
    if(t===0||amount===0)return sites;
    return sites.map((s,i)=>{
      let n=Math.imul((seed^Math.imul(i+1,1597334677))>>>0,2246822507)>>>0;
      n=(n^(n>>>16))>>>0;
      const angle=n/4294967296*TAU,c=Math.cos(angle),sn=Math.sin(angle);
      const radius=Math.min(180,(s.radius||Math.max(s.rx,s.ry))*.95)*amount;
      const u=Math.sin(theta)*radius,v=(1-Math.cos(theta))*radius*.42;
      return {...s,x:s.x+c*u-sn*v,y:s.y+sn*u+c*v};
    });
  }
  function motion(s,cycle,enabled=true){
    const t=((cycle%1)+1)%1,sine=Math.sin(t*TAU);
    return {
      phase:enabled&&s.breathing?sine*clamp(s.breathingIntensity/100):0,
      breathing:enabled&&!!s.breathing,
      shear:enabled&&s.sway?sine*.16*clamp(s.swayIntensity/100):0,
      drift:enabled&&s.drift&&s.driftIntensity>0?{cycle:t,intensity:s.driftIntensity}:null
    };
  }
  function toStage(p,size){const k=size/100;return {x:W/2+(p.x-W/2)*k,y:H/2+(p.y-H/2)*k};}
  function fromStage(p,size){const k=size/100;return {x:(p.x-W/2)/k+W/2,y:(p.y-H/2)/k+H/2};}
  globalThis.ManaRegions={place,drift,motion,toStage,fromStage,clamp};
})();
