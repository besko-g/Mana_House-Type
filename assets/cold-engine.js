/* Cold 04: continuous ink density -> correlated, opaque grain coverage.
 * No stamped rectangles, no solid fallback glyph underneath the effect.
 * Rendering is independent of the DOM so the same engine can be checked offline.
 */
(() => {
  "use strict";
  const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
  const mix = (a, b, t) => a + (b - a) * t;
  function random(seed) {
    let s = seed >>> 0;
    return () => {
      s += 0x6d2b79f5;
      let t = Math.imul(s ^ s >>> 15, s | 1);
      t ^= t + Math.imul(t ^ t >>> 7, t | 61);
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function hash(x, y, seed) {
    let t = Math.imul(x, 1597334677) ^ Math.imul(y, 3812015801) ^ seed;
    t = Math.imul(t ^ t >>> 16, 2246822507);
    t = Math.imul(t ^ t >>> 13, 3266489909);
    return ((t ^ t >>> 16) >>> 0) / 4294967296;
  }
  function noise(x, y, seed) {
    const ix = Math.floor(x), iy = Math.floor(y);
    const fx = x - ix, fy = y - iy;
    return mix(mix(hash(ix, iy, seed), hash(ix + 1, iy, seed), fx),
      mix(hash(ix, iy + 1, seed), hash(ix + 1, iy + 1, seed), fx), fy);
  }
  function sample(data, w, h, x, y) {
    if (x < 0 || y < 0 || x >= w - 1 || y >= h - 1) return 0;
    const ix = Math.floor(x), iy = Math.floor(y), k = iy * w + ix;
    return mix(mix(data[k], data[k + 1], x - ix),
      mix(data[k + w], data[k + w + 1], x - ix), y - iy);
  }
  function edtLine(f, length, d, v, z) {
    let k = 0;
    v[0] = 0; z[0] = -Infinity; z[1] = Infinity;
    for (let q = 1; q < length; q++) {
      let s;
      do {
        const p = v[k];
        s = ((f[q] + q * q) - (f[p] + p * p)) / (2 * (q - p));
        if (s > z[k]) break;
        k--;
      } while (k >= 0);
      k++; v[k] = q; z[k] = s; z[k + 1] = Infinity;
    }
    k = 0;
    for (let q = 0; q < length; q++) {
      while (z[k + 1] < q) k++;
      const dx = q - v[k]; d[q] = dx * dx + f[v[k]];
    }
  }
  function fontSpec(family, size) {
    const weights = { Light: 300, Regular: 400, Medium: 500, SemiBold: 600, Bold: 700, Heavy: 900 };
    const weight = Object.keys(weights).find(w => family.endsWith(w) || family.endsWith(w + "Italic"));
    return `${family.endsWith("Italic") ? "italic " : ""}${weights[weight] || 400} ${size}px "${family}"`;
  }

  class ColdEngine {
    constructor(createCanvas, { width = 2400, height = 1350, supersample = 2,
      yieldTask = () => new Promise(resolve => setTimeout(resolve, 0)) } = {}) {
      this.createCanvas = createCanvas;
      this.width = width; this.height = height; this.ss = supersample;
      this.yieldTask = yieldTask; this.geometry = null; this.pyramidKey = "";
      this.thresholdKey = ""; this.texture = null;
    }
    setTexture(data, width, height) {
      this.texture = { data, width, height }; this.thresholdKey = "";
    }
    async checkpoint(isCurrent) {
      if (!isCurrent()) throw new Error("COLD_CANCELLED");
      await this.yieldTask();
      if (!isCurrent()) throw new Error("COLD_CANCELLED");
    }
    async setText(text, family, isCurrent = () => true) {
      const key = `${text}\u0000${family}`;
      if (this.geometry?.key === key) return;
      const { width: w, height: h, ss } = this;
      const canvas = this.createCanvas(w * ss, h * ss);
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      ctx.font = fontSpec(family, 1000);
      ctx.textBaseline = "alphabetic"; ctx.textAlign = "left";
      const m = ctx.measureText(text);
      const inkWidth = Math.max(1, m.actualBoundingBoxLeft + m.actualBoundingBoxRight);
      const inkHeight = Math.max(1, m.actualBoundingBoxAscent + m.actualBoundingBoxDescent);
      const size = Math.min(w * ss * 0.82 / inkWidth, h * ss * 0.65 / inkHeight) * 1000;
      ctx.font = fontSpec(family, size);
      const fm = ctx.measureText(text);
      const left = (w * ss - fm.actualBoundingBoxLeft - fm.actualBoundingBoxRight) / 2;
      const top = (h * ss - fm.actualBoundingBoxAscent - fm.actualBoundingBoxDescent) / 2;
      ctx.fillStyle = "white";
      ctx.fillText(text, left + fm.actualBoundingBoxLeft, top + fm.actualBoundingBoxAscent);
      const rgba = ctx.getImageData(0, 0, w * ss, h * ss).data;
      const mask = new Float32Array(w * h);
      let area = 0;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          let a = 0;
          for (let sy = 0; sy < ss; sy++) for (let sx = 0; sx < ss; sx++)
            a += rgba[4 * ((y * ss + sy) * w * ss + x * ss + sx) + 3];
          mask[y * w + x] = a / (255 * ss * ss); area += mask[y * w + x];
        }
        if (y % 128 === 0) await this.checkpoint(isCurrent);
      }
      // Distance-to-background is used only for real contraction, never as a blur.
      const dist = new Float32Array(w * h);
      const max = Math.max(w, h), input = new Float64Array(max), out = new Float64Array(max);
      const v = new Int32Array(max), z = new Float64Array(max + 1), edges = [];
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) input[x] = mask[y * w + x] >= 0.5 ? 1e9 : 0;
        edtLine(input, w, out, v, z);
        for (let x = 0; x < w; x++) dist[y * w + x] = out[x];
      }
      await this.checkpoint(isCurrent);
      for (let x = 0; x < w; x++) {
        for (let y = 0; y < h; y++) input[y] = dist[y * w + x];
        edtLine(input, h, out, v, z);
        for (let y = 0; y < h; y++) dist[y * w + x] = Math.sqrt(out[y]);
      }
      const ridges = [];
      for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
        const i = y * w + x, d = dist[i];
        if (mask[i] > 0.5 && (mask[i - 1] < 0.5 || mask[i + 1] < 0.5 || mask[i - w] < 0.5 || mask[i + w] < 0.5)) {
          if ((x + y) % 3 === 0) edges.push(i);
        }
        if (d > 1 && x % 3 === 0 && y % 3 === 0 && d >= dist[i - 1] && d >= dist[i + 1] && d >= dist[i - w] && d >= dist[i + w]) ridges.push(d);
      }
      ridges.sort((a, b) => a - b);
      const stroke = clamp(2 * (ridges[Math.floor(ridges.length * 0.60)] || size / ss * 0.035), size / ss * 0.012, size / ss * 0.20);
      this.geometry = { key, text, family, mask, dist, edges, area, stroke, size: size / ss,
        bounds: { x: left / ss, y: top / ss, width: (fm.actualBoundingBoxLeft + fm.actualBoundingBoxRight) / ss,
          height: (fm.actualBoundingBoxAscent + fm.actualBoundingBoxDescent) / ss } };
      canvas.width = 1; canvas.height = 1;
      this.pyramidKey = "";
    }
    async buildPyramid(contraction, isCurrent) {
      const key = `${this.geometry.key}:${contraction}`;
      if (this.pyramidKey === key) return;
      const { width: w, height: h } = this, { mask, dist, stroke } = this.geometry;
      const erosion = Math.pow(contraction / 100, 1.35) * stroke * 0.19;
      const base = new Float32Array(mask.length);
      for (let i = 0; i < base.length; i++) {
        // Soft coverage of a contracted silhouette, clamped by the original ink.
        base[i] = Math.min(mask[i], clamp(dist[i] - erosion));
        if (!erosion) base[i] = mask[i];
      }
      const levels = [{ data: base, width: w, height: h, scale: 1, variance: 0 }];
      const kernel = [1, 4, 6, 4, 1];
      while (levels.length < 10) {
        const p = levels[levels.length - 1];
        const nw = Math.ceil(p.width / 2), nh = Math.ceil(p.height / 2);
        if (nw < 3 || nh < 3) break;
        const horizontal = new Float32Array(nw * p.height), down = new Float32Array(nw * nh);
        for (let y = 0; y < p.height; y++) for (let x = 0; x < nw; x++) {
          let sum = 0;
          for (let t = -2; t <= 2; t++) if (2 * x + t >= 0 && 2 * x + t < p.width)
            sum += p.data[y * p.width + 2 * x + t] * kernel[t + 2];
          horizontal[y * nw + x] = sum / 16;
        }
        for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) {
          let sum = 0;
          for (let t = -2; t <= 2; t++) if (2 * y + t >= 0 && 2 * y + t < p.height)
            sum += horizontal[(2 * y + t) * nw + x] * kernel[t + 2];
          down[y * nw + x] = sum / 16;
        }
        levels.push({ data: down, width: nw, height: nh, scale: p.scale * 2, variance: p.variance + p.scale * p.scale });
        await this.checkpoint(isCurrent);
      }
      this.levels = levels; this.pyramidKey = key;
    }
    makeSites(seed, count, locations = []) {
      const { edges, size, bounds } = this.geometry, w = this.width;
      const rng = random(seed ^ 0xa3b19247), sites = [];
      if (!edges.length) return sites;
      // A stable ordered sequence: increasing quantity appends sites without moving existing ones.
      for (let n = 0; n < count; n++) {
        let best, bestScore = -1;
        for (let a = 0; a < 7; a++) {
          const i = edges[Math.floor(rng() * edges.length)];
          const x = i % w, y = Math.floor(i / w);
          const score = sites.length ? Math.min(...sites.map(s => Math.hypot(x - s.x, y - s.y))) : rng();
          if (score > bestScore) { best = { x, y }; bestScore = score; }
        }
        sites.push({ ...best, rx: size * (0.13 + rng() * 0.14), ry: size * (0.12 + rng() * 0.15),
          gain: 1.0 + rng() * 0.6, angle: rng() * 6.283185 });
      }
      return ManaRegions.place(sites, locations, this.width, this.height);
    }
    async buildThreshold(seed, grainSize, isCurrent) {
      const key = `${seed}:${grainSize}`;
      if (key === this.thresholdKey) return;
      const { width: w, height: h, ss } = this, rw = w * ss, rh = h * ss;
      const raw = new Uint16Array(rw * rh), histogram = new Uint32Array(4096);
      const grain = (0.55 + grainSize * 0.047) * (w / 2400);
      const texture = this.texture, rng = random(seed ^ 0x947bac1f);
      const tx = Math.floor(rng() * (texture?.width || 1)), ty = Math.floor(rng() * (texture?.height || 1));
      for (let y = 0; y < rh; y++) {
        const py = (y + 0.5) / ss;
        for (let x = 0; x < rw; x++) {
          const px = (x + 0.5) / ss;
          const n = noise(px / grain, py * 1.25 / grain, seed);
          const fine = noise(px / (grain * 0.38), py / (grain * 0.38), seed ^ 0x175d4269);
          let dirty = 0.5;
          if (texture) {
            const u = (Math.floor(px * 1.8 / grain) + tx) % texture.width;
            const v = (Math.floor(py * 1.8 / grain) + ty) % texture.height;
            dirty = texture.data[v * texture.width + u] / 255;
          }
          const value = clamp(Math.floor((0.77 * n + 0.15 * fine + 0.08 * dirty) * 4095), 0, 4095);
          raw[y * rw + x] = value; histogram[value]++;
        }
        if (y % 80 === 0) await this.checkpoint(isCurrent);
      }
      // Histogram equalisation makes thresholds uniformly distributed: alpha means area coverage.
      const cdf = new Uint16Array(4096); let sum = 0;
      for (let i = 0; i < histogram.length; i++) { cdf[i] = Math.round((sum + histogram[i] * 0.5) / raw.length * 65535); sum += histogram[i]; }
      for (let i = 0; i < raw.length; i++) raw[i] = cdf[raw[i]];
      this.thresholds = raw; this.thresholdKey = key;
    }
    async densityField(params, isCurrent) {
      const { width: w, height: h, geometry: g } = this;
      const sites = this.makeSites(params.seed, params.regions, params.locations?.dissolution);
      const strength = params.intensity / 100, spread = params.spread / 100, fade = params.fade / 100;
      const active = sites.length > 0 && (strength > 0 || fade > 0);
      const density = new Float32Array(w * h);
      // Field controls are low frequency; micro-grain is applied only after this continuous stage.
      const step = 10, gw = Math.ceil(w / step) + 1, gh = Math.ceil(h / step) + 1;
      const field = new Float32Array(gw * gh);
      for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
        const px = x * step, py = y * step;
        const wx = px + (noise(px / 125, py / 125, params.seed + 11) - 0.5) * g.size * 0.1;
        const wy = py + (noise(px / 135, py / 135, params.seed + 23) - 0.5) * g.size * 0.1;
        let hot = 0;
        for (const s of sites) {
          const dx = wx - s.x, dy = wy - s.y, c = Math.cos(s.angle), sn = Math.sin(s.angle);
          const u = (dx * c + dy * sn) / s.rx, v = (-dx * sn + dy * c) / s.ry;
          hot += Math.exp(-2.8 * (u * u + v * v)) * s.gain;
        }
        field[y * gw + x] = clamp(hot);
      }
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const hot = sample(field, gw, gh, x / step, y / step);
          const sigma = (active ? 0.62 : 0) + g.stroke * 1.75 * spread * hot * strength;
          const variance = sigma * sigma;
          const lo = clamp(Math.floor(Math.log2(1 + 3 * variance) * 0.5), 0, this.levels.length - 2);
          const a = this.levels[lo], b = this.levels[lo + 1];
          const t = clamp((variance - a.variance) / (b.variance - a.variance));
          const warp = (1.5 + g.stroke * 0.12) * hot * strength;
          const dx = (noise(x / 18, y / 18, params.seed + 47) - 0.5) * warp;
          const dy = (noise(x / 22, y / 22, params.seed + 59) - 0.5) * warp;
          const alpha = mix(sample(a.data, a.width, a.height, (x + dx) / a.scale, (y + dy) / a.scale),
            sample(b.data, b.width, b.height, (x + dx) / b.scale, (y + dy) / b.scale), t);
          const p = Math.pow(clamp(alpha), 1 + fade * 0.7 * hot) * (1 - fade * hot * 0.10);
          density[y * w + x] = p < 0.012 ? 0 : p;
        }
        if (y % 48 === 0) await this.checkpoint(isCurrent);
      }
      return { density, sites };
    }
    async render(params, isCurrent = () => true) {
      if (!this.geometry) throw new Error("Load a font and text before rendering.");
      await this.buildPyramid(params.contraction, isCurrent);
      await this.buildThreshold(params.seed, params.grain, isCurrent);
      const { density, sites } = await this.densityField(params, isCurrent);
      const { width: w, height: h, ss } = this, rw = w * ss, rh = h * ss;
      const canvas = this.createCanvas(rw, rh), ctx = canvas.getContext("2d");
      const image = ctx.createImageData(rw, rh), data = image.data;
      const active = params.regions > 0 && (params.intensity > 0 || params.fade > 0);
      let occupied = 0, outside = 0, removed = 0;
      for (let y = 0; y < rh; y++) {
        for (let x = 0; x < rw; x++) {
          const i = y * rw + x, p = sample(density, w, h, (x + 0.5) / ss - 0.5, (y + 0.5) / ss - 0.5);
          const alpha = active ? (p > 0 && p * 65535 >= this.thresholds[i] ? 255 : 0) : Math.round(p * 255);
          const on = alpha >= 128;
          const offset = i * 4;
          data[offset] = 255; data[offset + 1] = 255; data[offset + 2] = 255; data[offset + 3] = alpha;
          const original = this.geometry.mask[Math.floor(y / ss) * w + Math.floor(x / ss)] > 0.5;
          if (on) { occupied++; if (!original) outside++; } else if (original) removed++;
        }
        if (y % 80 === 0) await this.checkpoint(isCurrent);
      }
      ctx.putImageData(image, 0, 0);
      return { canvas, density, sites, stats: { occupied, outside, removed, stroke: this.geometry.stroke,
        inputArea: this.geometry.area * ss * ss, renderWidth: rw, renderHeight: rh } };
    }
  }
  globalThis.ManaCold = { ColdEngine, fontSpec, sample, noise };
})();
