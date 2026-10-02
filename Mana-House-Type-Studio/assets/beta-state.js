(() => {
  "use strict";
  const createState = () => ({
    mode: "heat",
    heat: {
      text: "Heat,", font: "SeasonSansMedium", size: 100, typeColor: "#C93200", background: "#1A1A1A", breathing: false, breathingIntensity: 50,
      sway: false, swayIntensity: 45, drift: false, driftIntensity: 50,
      params: { seed: 1701, expansion: 36, expansionBlur: 26, deformations: 7, deformationStrength: 50, blur: 70, locations: {} }
    },
    cold: {
      text: "Cold,", font: "SeasonSerifLight", size: 100, typeColor: "#C08040", background: "#F5EEE4", breathing: false, breathingIntensity: 50,
      sway: false, swayIntensity: 45, drift: false, driftIntensity: 50,
      params: { seed: 1907, contraction: 30, spread: 50, regions: 9, intensity: 60, fade: 50, grain: 40, locations: {} }
    }
  });
  // Composition settings are intentionally excluded: color and scale may never
  // regenerate the random field, the font layout or either effect.
  const renderKey = s => JSON.stringify([s.text.replace(/\s+/g, " ").trim(), s.font, s.params]);
  const MAX_BREATH_AMPLITUDE = 6;
  const breatheParams = (mode,params,phase,amplitude=1) => {
    const p={...params};
    const ranges=mode==='heat'?{expansion:.065,deformationStrength:.09,blur:.08,expansionBlur:.05}:{contraction:.08,spread:.06,intensity:.04};
    for(const [key,amount] of Object.entries(ranges))p[key]=Math.max(0,Math.min(100,params[key]*(1+amount*phase*amplitude)));
    return p;
  };
  const breathePhase = (phase,intensity) => phase*Math.max(0,Math.min(100,intensity))/100;
  globalThis.ManaBeta = { createState, renderKey, breatheParams, breathePhase, MAX_BREATH_AMPLITUDE };
})();
