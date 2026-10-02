/* Heat beta: the Alpha 08 contour model with full-resolution Float32 diffusion.
 * Distances are used only to shape ink. Blur always convolves the ink coverage.
 * No mipmap, reduced blur texture, medial-axis blur or intermediate 8-bit alpha.
 */
(() => {
  "use strict";
  const clamp = (x, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, x));
  const mix = (a, b, t) => a + (b - a) * t;
  const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
  const fract = x => x - Math.floor(x);
  function random(initialSeed) {
    let value = initialSeed >>> 0;
    return () => {
      value += 0x6D2B79F5;
      let t = value; t = Math.imul(t ^ t >>> 15, t | 1);
      t ^= t + Math.imul(t ^ t >>> 7, t | 61);
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function noise(x, y, seed) {
    const ix = Math.floor(x), iy = Math.floor(y);
    let fx = x - ix, fy = y - iy;
    fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
    const hash = (a, b) => fract(Math.sin(a * 127.1 + b * 311.7 + seed * .019) * 43758.5453123);
    return mix(mix(hash(ix, iy), hash(ix + 1, iy), fx), mix(hash(ix, iy + 1), hash(ix + 1, iy + 1), fx), fy);
  }
  function edtLine(input, length, output, vectors, boundaries) {
    let k = 0; vectors[0] = 0; boundaries[0] = -Infinity; boundaries[1] = Infinity;
    for (let q = 1; q < length; q++) {
      let s;
      while (true) {
        const p = vectors[k]; s = ((input[q] + q * q) - (input[p] + p * p)) / (2 * (q - p));
        if (s > boundaries[k] || k === 0) break;
        k--;
      }
      k++; vectors[k] = q; boundaries[k] = s; boundaries[k + 1] = Infinity;
    }
    k = 0;
    for (let q = 0; q < length; q++) {
      while (boundaries[k + 1] < q) k++;
      const d = q - vectors[k]; output[q] = d * d + input[vectors[k]];
    }
  }

  // A fractional-edge box has an exact prescribed variance. Six separable
  // passes approximate a Gaussian without sparse sampling or integer-radius jumps.
  function boxParameters(variance) {
    const radius = Math.floor((Math.sqrt(12 * variance + 1) - 1) / 2);
    const count = 2 * radius + 1;
    const edge = clamp(count * (variance - radius * (radius + 1) / 3) /
      (2 * ((radius + 1) ** 2 - variance)));
    return { radius, edge, norm: 1 / (count + 2 * edge) };
  }
  function boxHorizontal(src, dst, w, h, p) {
    const { radius: r, edge: a, norm } = p;
    for (let y = 0; y < h; y++) {
      const row = y * w; let sum = 0;
      for (let k = -r; k <= r; k++) sum += src[row + clamp(k, 0, w - 1)];
      for (let x = 0; x < w; x++) {
        const l = Math.max(0, x - r - 1), rr = Math.min(w - 1, x + r + 1);
        dst[row + x] = (sum + a * (src[row + l] + src[row + rr])) * norm;
        sum += src[row + rr] - src[row + Math.max(0, x - r)];
      }
    }
  }
  function boxVertical(src, dst, w, h, p) {
    const { radius: r, edge: a, norm } = p, sums = new Float64Array(w);
    for (let k = -r; k <= r; k++) {
      const row = clamp(k, 0, h - 1) * w;
      for (let x = 0; x < w; x++) sums[x] += src[row + x];
    }
    for (let y = 0; y < h; y++) {
      const row = y * w, top = Math.max(0, y - r - 1) * w;
      const bottom = Math.min(h - 1, y + r + 1) * w, remove = Math.max(0, y - r) * w;
      for (let x = 0; x < w; x++) {
        dst[row + x] = (sums[x] + a * (src[top + x] + src[bottom + x])) * norm;
        sums[x] += src[bottom + x] - src[remove + x];
      }
    }
  }
  async function gaussianIncrement(src, w, h, sigma, checkpoint) {
    if (sigma < 1e-5) return src.slice();
    const p = boxParameters(sigma * sigma / 6);
    const a = new Float32Array(src.length), b = new Float32Array(src.length);
    let current = src;
    for (let pass = 0; pass < 6; pass++) {
      boxHorizontal(current, a, w, h, p); await checkpoint();
      boxVertical(a, b, w, h, p); await checkpoint(); current = b;
    }
    return b;
  }
  async function diffuse(mask, sigmaMap, w, h, checkpoint) {
    let maxSigma = 0;
    for (let i = 0; i < sigmaMap.length; i++) maxSigma = Math.max(maxSigma, sigmaMap[i]);
    if (maxSigma < 1e-5) return mask.slice();
    const result = new Float32Array(mask.length);
    let previous = mask, prevSigma = 0, nextSigma = .7;
    while (prevSigma < maxSigma) {
      const next = await gaussianIncrement(previous, w, h, Math.sqrt(nextSigma ** 2 - prevSigma ** 2), checkpoint);
      const lo = prevSigma ** 2, hi = nextSigma ** 2;
      for (let i = 0; i < result.length; i++) {
        const s = sigmaMap[i];
        if (s >= prevSigma && s <= nextSigma) result[i] = clamp(mix(previous[i], next[i], (s * s - lo) / (hi - lo)));
      }
      previous = next; prevSigma = nextSigma; nextSigma *= 1.5;
      await checkpoint();
    }
    return result;
  }

  class HeatEngine {
    constructor(createCanvas, { width = 2400, height = 1350, supersample = 2,
      yieldTask = () => new Promise(resolve => setTimeout(resolve, 0)) } = {}) {
      this.createCanvas = createCanvas; this.width = width; this.height = height;
      this.ss = supersample; this.yieldTask = yieldTask; this.geometry = null;
    }
    async checkpoint(isCurrent) {
      if (!isCurrent()) throw new Error("HEAT_CANCELLED");
      await this.yieldTask();
      if (!isCurrent()) throw new Error("HEAT_CANCELLED");
    }
    async setText(text, family, isCurrent = () => true) {
      const key = text + "\u0000" + family;
      if (this.geometry?.key === key) return;
      const { width: w, height: h, ss } = this, sw = w * ss, sh = h * ss;
      const c = this.createCanvas(sw, sh), ctx = c.getContext("2d", { willReadFrequently: true });
      const size = 300 * (w / 1200) * ss;
      ctx.font = globalThis.ManaCold.fontSpec(family, size);
      const measured = ctx.measureText(text);
      const fitted = Math.min(size, size * sw * .86 / Math.max(1, measured.width));
      ctx.font = globalThis.ManaCold.fontSpec(family, fitted);
      ctx.textAlign = "center"; ctx.textBaseline = "alphabetic"; ctx.fillStyle = "white";
      const metrics = ctx.measureText(text);
      ctx.fillText(text, sw / 2, sh / 2 + (metrics.actualBoundingBoxAscent - metrics.actualBoundingBoxDescent) / 2);
      let rgba = ctx.getImageData(0, 0, sw, sh).data;
      const mask = new Uint8Array(sw * sh);
      for (let i = 0; i < mask.length; i++) mask[i] = rgba[i * 4 + 3];
      rgba = null; c.width = 1; c.height = 1;
      await this.checkpoint(isCurrent);
      const source = new Float32Array(sw * sh); source.fill(1e12);
      const boundary = [];
      for (let y = 1; y < sh - 1; y++) for (let x = 1; x < sw - 1; x++) {
        const k = y * sw + x, inside = mask[k] >= 128;
        if ((mask[k] > 0 && mask[k] < 255) || inside !== (mask[k - 1] >= 128) || inside !== (mask[k + 1] >= 128) ||
          inside !== (mask[k - sw] >= 128) || inside !== (mask[k + sw] >= 128)) {
          source[k] = 0;
          if (inside && ((x + y) & 1) === 0) boundary.push(k);
        }
      }
      const length = Math.max(sw, sh), input = new Float64Array(length), out = new Float64Array(length);
      const vectors = new Int32Array(length), bounds = new Float64Array(length + 1);
      for (let y = 0; y < sh; y++) {
        const row = y * sw; input.set(source.subarray(row, row + sw));
        edtLine(input, sw, out, vectors, bounds); source.set(out.subarray(0, sw), row);
        if (y % 256 === 0) await this.checkpoint(isCurrent);
      }
      for (let x = 0; x < sw; x++) {
        for (let y = 0; y < sh; y++) input[y] = source[y * sw + x];
        edtLine(input, sh, out, vectors, bounds);
        for (let y = 0; y < sh; y++) {
          const k = y * sw + x;
          source[k] = Math.sqrt(out[y]) * (mask[k] >= 128 ? -1 : 1) + .5 - mask[k] / 255;
        }
        if (x % 256 === 0) await this.checkpoint(isCurrent);
      }
      // The source geometry is sampled at 2x the PNG dimensions; distances keep
      // their fractional precision at the canonical working size.
      const sdf = new Float32Array(w * h);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        sdf[y * w + x] = globalThis.ManaCold.sample(source, sw, sh, (x + .5) * ss - .5, (y + .5) * ss - .5);
      }
      this.geometry = { key, sdf, boundary }; this.shapeKey = "";
    }
    makeMaps(seed, locations = {}) {
      const { width: w, height: h, ss, geometry } = this, rng = random(seed), sw = w * ss, sh = h * ss;
      const set = (count, lo, hi) => Array.from({ length: count }, () => {
        const k = geometry.boundary.length ? geometry.boundary[Math.floor(rng() * geometry.boundary.length)] : sh / 2 * sw + sw / 2;
        return { x: (k % sw) / ss, y: Math.floor(k / sw) / ss, radius: (lo + rng() * (hi - lo)) * w / 1200,
          strength: .48 + rng() * .42 };
      });
      const blur = set(12, 58, 138), deforms = set(20, 12, 36);
      for (const p of deforms) {
        p.angle = rng() * Math.PI * 2;
        const sign = rng() < .76 ? 1 : -.58;
        p.amount = (4 + rng() * 14) * w / 1200 * ss * sign;
        p.stretch = mix(1.15, 1.65, fract(Math.sin(p.x / w * 317 * 127.1 + p.y / h * 317 * 311.7 + seed * .019) * 43758.5453123));
      }
      return { blur: ManaRegions.place(blur, locations.blur, w, h), deforms: ManaRegions.place(deforms, locations.deform, w, h) };
    }
    async render(params, isCurrent = () => true) {
      const { width: w, height: h, ss, geometry: g } = this;
      if (!g) throw new Error("Heat needs a text mask.");
      const { seed, expansion, expansionBlur, deformations, deformationStrength, blur } = params;
      const maps = this.makeMaps(seed, params.locations), shapeKey = [g.key, seed, expansion, deformations, deformationStrength, JSON.stringify(params.locations?.deform)].join("|");
      const check = () => this.checkpoint(isCurrent);
      let mask = this.mask;
      if (shapeKey !== this.shapeKey) {
        const field = new Float32Array(w * h);
        for (const p of maps.deforms.slice(0, deformations)) {
          const radius = p.radius / .84, sine = Math.sin(p.angle), cosine = Math.cos(p.angle);
          const stretch = p.stretch;
          for (let y = Math.max(0, Math.floor(p.y - radius)); y < Math.min(h, p.y + radius); y++) {
            for (let x = Math.max(0, Math.floor(p.x - radius)); x < Math.min(w, p.x + radius); x++) {
              const dx = x + .5 - p.x, dy = y + .5 - p.y;
              const lx = cosine * dx + sine * dy, ly = (-sine * dx + cosine * dy) * stretch;
              const irregular = noise(lx / 24 + p.x / w * 91, ly / 24 + p.y / h * 91, seed);
              const d = Math.hypot(lx, ly) / p.radius * mix(.84, 1.16, irregular);
              const f = clamp(1 - d); field[y * w + x] += f * f * (3 - 2 * f) * p.amount * deformationStrength / 100;
            }
          }
          await check();
        }
        mask = new Float32Array(w * h);
        const expand = (expansion / 100) ** 1.65 * 40 * w / 1200 * ss;
        const active = smooth(0, 8 * ss, expand);
        for (let y = 1; y < h - 1; y++) {
          for (let x = 1; x < w - 1; x++) {
            const i = y * w + x, d = g.sdf[i] - field[i];
            if (d - expand > 16 * ss) continue;
            if (d - expand < -16 * ss) { mask[i] = 1; continue; }
            const fine = noise((x + .5) * ss / 3.2 + 31, (y + .5) * ss / 3.2 + 79, seed);
            const micro = noise((x + .5) * ss / 1.45 + 113, (y + .5) * ss / 1.45 + 47, seed);
            const altered = d - expand + (mix(fine, micro, .42) - .5) * Math.min(expand * .12, ss * 6);
            const dx = Math.abs((g.sdf[i + 1] - field[i + 1]) - (g.sdf[i - 1] - field[i - 1])) * .5;
            const dy = Math.abs((g.sdf[i + w] - field[i + w]) - (g.sdf[i - w] - field[i - w])) * .5;
            const softness = Math.max(dx + dy, ss * .72) * .88;
            const edge = 1 - smooth(softness * .35, softness * 4 + ss * 2, Math.abs(altered));
            mask[i] = (1 - smooth(-softness, softness, altered)) * (1 - active * edge * mix(.018, .11, micro));
          }
          if (y % 160 === 0) await check();
        }
        this.mask = mask; this.shapeKey = shapeKey;
      }
      const field = new Float32Array(w * h);
      for (const p of maps.blur.slice(0, Math.ceil(blur / 100 * 12))) {
        const radius = p.radius / .78;
        for (let y = Math.max(0, Math.floor(p.y - radius)); y < Math.min(h, p.y + radius); y++) {
          for (let x = Math.max(0, Math.floor(p.x - radius)); x < Math.min(w, p.x + radius); x++) {
            const dx = x + .5 - p.x, dy = y + .5 - p.y;
            const n = noise(dx / 42 + p.x / w * 73 + p.strength * 19, dy / 42 + p.y / h * 73 + p.strength * 19, seed);
            const d = Math.hypot(dx, dy) / p.radius * mix(.78, 1.22, n), f = clamp(1 - d);
            field[y * w + x] += f * f * (3 - 2 * f) * p.strength;
          }
        }
        await check();
      }
      const sigma = new Float32Array(w * h);
      const globalRadius = smooth(0, .08, expansion / 100) * expansionBlur * .1 * w / 1200;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = y * w + x;
          const variation = field[i] > 0 ? mix(.82, 1.12, noise((x + .5) / 84 + 29, (y + .5) / 84 + 29, seed)) : 1;
          const local = blur * .34 * w / 1200 * Math.min(1.5, field[i]) * variation;
          // Alpha 08's slider radius was approximately twice its true sigma.
          sigma[i] = .5 * Math.hypot(local, globalRadius);
        }
        if (y % 256 === 0) await check();
      }
      const density = await diffuse(mask, sigma, w, h, check);
      return { density, width: w, height: h };
    }
  }

  function dither(x, y) {
    let t = Math.imul(x + 1, 1597334677) ^ Math.imul(y + 1, 3812015801);
    t = Math.imul(t ^ t >>> 16, 2246822507); t = Math.imul(t ^ t >>> 13, 3266489909);
    return ((t ^ t >>> 16) >>> 0) / 4294967296 - .5;
  }
  function paint(context, result, { typeColor, background, size }) {
    const { width: w, height: h } = context.canvas, image = context.createImageData(w, h), pixels = image.data;
    const rgb = hex => [1, 3, 5].map(k => parseInt(hex.slice(k, k + 2), 16));
    const ink = rgb(typeColor), bg = background ? rgb(background) : null, scale = size / 100;
    const src = result?.density;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x, k = i * 4;
      const a = !src ? 0 : scale === 1 ? src[i] : globalThis.ManaCold.sample(src, w, h,
        (x + .5 - w / 2) / scale + w / 2 - .5, (y + .5 - h / 2) / scale + h / 2 - .5);
      const n = a > 0 && a < 1 ? dither(x, y) : 0;
      if (bg) {
        for (let c = 0; c < 3; c++) pixels[k + c] = Math.round(mix(bg[c], ink[c], a) + n);
        pixels[k + 3] = 255;
      } else {
        pixels[k] = ink[0]; pixels[k + 1] = ink[1]; pixels[k + 2] = ink[2];
        pixels[k + 3] = Math.round(a * 255 + n);
      }
    }
    context.putImageData(image, 0, 0);
  }
  globalThis.ManaHeat = { HeatEngine, paint, gaussianIncrement, boxParameters, diffuse };
})();
