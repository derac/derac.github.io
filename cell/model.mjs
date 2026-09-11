// The shared, deterministic model also powers the no-WebGPU worker fallback.
export const SCALES = 6;
export const CHANNELS = 8;
export const LAYER_FIELDS = {
  Radius: ['Radius multiplier', 0.25, 4, 0.01], Range: ['Inhibitor multiplier', 0.6, 2, 0.01],
  Gain: ['Reaction strength', 0, 3, 0.01], Preference: ['Selection preference', 0.2, 4, 0.01],
  Region: ['Region response', -1, 1, 0.01],
};
export const SPEC = {
  scale: ['Fine radius', 1, 5, 0.05], spacing: ['Scale spacing', 1.5, 2.8, 0.01],
  ratio: ['Inhibitor / activator', 1.2, 3, 0.01], rate: ['Reaction amount', 0.2, 3, 0.01],
  bias: ['Fine ↔ coarse preference', -0.6, 0.6, 0.01],
  growth: ['Inflation per step', 0, 0.008, 0.00001],
  feed: ['Feed', 0.012, 0.07, 0.0001], kill: ['Kill', 0.035, 0.075, 0.0001],
  diffusion: ['Diffusion', 0.06, 0.24, 0.001], coupling: ['History coupling', 0, 0.04, 0.0001],
  memory: ['History update', 0.001, 0.08, 0.001],
  hue: ['Palette phase', 0, 1, 0.001], bands: ['Color cycles', 0.4, 4, 0.01],
  contrast: ['Contrast', 0.4, 2, 0.01], relief: ['Relief shading', 0, 1.5, 0.01],
  colorMix: ['Scale / history color', 0, 1, 0.01],
  regionality: ['Regional scale competition', 0, 4, 0.01],
  regionVariation: ['Regional chemistry variation', 0, 1, 0.01],
  colorMemory: ['Layer history update', 0.005, 0.2, 0.001],
  separation: ['Color separation', 0.5, 12, 0.1], colorDrift: ['Regional color variation', 0, 3, 0.01],
  saturation: ['Saturation', 0, 1.8, 0.01],
};
const layerDefaults = {};
for (let i = 1; i <= SCALES; i++) {
  for (const [suffix, spec] of Object.entries(LAYER_FIELDS)) {
    SPEC[`layer${i}${suffix}`] = [`Layer ${i} · ${spec[0]}`, ...spec.slice(1)];
    layerDefaults[`layer${i}${suffix}`] = suffix === 'Region' ? [-0.8, 0.55, -0.3, 0.8, -0.55, 0.35][i-1] : 1;
  }
  layerDefaults[`layer${i}Color`] = null;
}
export const DEFAULTS = Object.freeze({ mode: 'turing', seed: 20020, ruleSeed: 1047, colorSeed: 731,
  scale: 2.1, spacing: 1.85, ratio: 1.9, rate: 0.7, bias: 0,
  growth: 0.0005, feed: 0.0367, kill: 0.0649, diffusion: 0.2, coupling: 0.012, memory: 0.012,
  hue: 0.12, bands: 0.8, contrast: 1.12, relief: 0.2, colorMix: 1, palette: 'mineral', view: 'color',
  colorStyle: 'layers', kernel: 'smooth', regionality: 1.4, regionVariation: 0.65, colorMemory: 0.045, separation: 4,
  colorDrift: 1, saturation: 1.15, ...layerDefaults,
});
export const PRESETS = {
  mineral: { name: 'Mineral strata · independent scales', ...DEFAULTS, layer1Gain: 0.55, layer2Gain: 0.75 },
  growing: { name: 'Fine mineral folds', ...DEFAULTS, scale:1.4, spacing:2.1, layer1Gain:0.55, layer2Gain:0.75 },
  rough: { name: 'Granular strata · square kernel', ...DEFAULTS, kernel:'box',scale:3.2,spacing:2.1,layer1Gain:0.55,layer2Gain:0.75 },
  spectral: { name: 'Chromatic strata', ...DEFAULTS, colorStyle:'spectral',seed:1638,colorDrift:1.5,saturation:0.85,colorMix:0.65 },
  coral: { name:'Mosaic cells · regional reactions', ...DEFAULTS,mode:'lattice',feed:0.036,kill:0.0605,
    coupling:0.007,memory:0.007,growth:0,seed:2718,regionVariation:0.5,bands:0.85 },
  mitosis: { name:'Cells & labyrinths · regional reactions', ...DEFAULTS,mode:'lattice',feed:0.028,kill:0.055,
    coupling:0.007,memory:0.007,growth:0,seed:2718,regionVariation:0.5,palette:'ember',bands:0.85 },
};
export const clamp = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
export function hash(x) {
  x >>>= 0; x ^= x >>> 16; x = Math.imul(x, 0x7feb352d);
  x ^= x >>> 15; x = Math.imul(x, 0x846ca68b); return (x ^ (x >>> 16)) >>> 0;
}
export const random = x => hash(x) / 4294967296;
export function validateParams(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('Parameters must be an object.');
  const p = { ...DEFAULTS };
  for (const [key, value] of Object.entries(input)) {
    if (key === 'name') continue;
    if (Object.hasOwn(SPEC, key)) {
      if (!Number.isFinite(value) || value < SPEC[key][1] || value > SPEC[key][2]) throw Error(`Invalid ${key}.`);
    } else if (['seed', 'ruleSeed', 'colorSeed'].includes(key)) {
      if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) throw Error(`Invalid ${key}.`);
    } else if (key === 'mode') {
      if (!['turing', 'lattice'].includes(value)) throw Error('Unknown model.');
    } else if (key === 'palette') {
      if (!['mineral', 'ember', 'lagoon'].includes(value)) throw Error('Unknown palette.');
    } else if (key === 'view') {
      if (!['color', 'field', 'regions', 'raw'].includes(value)) throw Error('Unknown view.');
    } else if (key === 'colorStyle') {
      if (!['legacy', 'layers', 'spectral'].includes(value)) throw Error('Unknown color mapping.');
    } else if (key === 'kernel') {
      if (!['box','smooth'].includes(value)) throw Error('Unknown averaging kernel.');
    } else if (/^layer[1-6]Color$/.test(key)) {
      if (value !== null && (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value))) throw Error('Invalid layer color.');
    } else throw Error(`Unknown parameter: ${key}`);
    p[key] = value;
  }
  return p;
}
export function scaleConfig(p, n) {
  return Array.from({ length: SCALES }, (_, s) => {
    const key = `layer${s+1}`;
    // Layers are independent and may cross in scale; do not reorder their identities/colors.
    const r = Math.max(1, Math.min(Math.floor(n * 0.30), Math.round(p.scale * n / 512 * p.spacing ** s * p[`${key}Radius`])));
    const inhibitor = Math.max(r + 1, Math.min(Math.floor(n * 0.47), Math.round(r * Math.max(1.1, p.ratio * p[`${key}Range`]))));
    const variation = 0.8 + 0.4 * random(p.ruleSeed + s * 701);
    return { r, inhibitor, amount: 0.018 * 1.36 ** s * p.rate * variation * p[`${key}Gain`],
      weight: (s + 1) ** (-p.bias) / p[`${key}Preference`], gate: p[`${key}Region`], color: s / (SCALES - 1) };
  });
}
export function coefficients(p) {
  return [0, 1, 2, 3].map(i => 0.8 + 0.4 * random(p.ruleSeed + i * 307));
}
export function initialField(n, p) {
  const data = new Float32Array(n * n * CHANNELS);
  const spots = Array.from({ length: 54 }, (_, i) => [random(p.seed + 103 * i) * n,
    random(p.seed + 107 * i + 7001) * n, n * (0.009 + 0.018 * random(p.seed + 211 * i))]);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const i = (y * n + x) * CHANNELS, noise = random((y * n + x) ^ p.seed);
    if (p.mode === 'turing') {
      data[i] = noise * 2 - 1;
      for (let s = 0; s < 6; s++) data[i + 1 + s] = 1/6;
      data[i + 7] = 0;
    } else {
      const inside = spots.some(([sx, sy, r]) => {
        const dx = Math.min(Math.abs(x - sx), n - Math.abs(x - sx));
        const dy = Math.min(Math.abs(y - sy), n - Math.abs(y - sy));
        return dx * dx + dy * dy < r * r;
      });
      data[i] = inside ? 0.48 + noise * 0.04 : 1;
      data[i + 1] = inside ? 0.24 + noise * 0.04 : noise * 0.001;
      data[i + 2] = inside ? 0.1 : 0;
      data[i + 3] = 0;
      const phase = random(p.seed + 1927) * Math.PI * 2, phase2 = random(p.seed + 4721) * Math.PI * 2;
      const a = x / n * Math.PI * 2, b = y / n * Math.PI * 2;
      data[i+4] = (Math.sin(a + phase) + 0.65*Math.cos(b*2 + phase2) + 0.4*Math.sin(a*2-b + phase))/2.05;
      data[i+5] = (Math.cos(b + phase2) + 0.6*Math.sin(a*2 + phase) + 0.45*Math.cos(a+b*2))/2.05;
      data[i+6] = data[i+1]; data[i+7] = data[i+2];
    }
  }
  return data;
}
// Exact periodic separable box filter, O(N²), independent of radius.
export function boxBlur(src, n, r, out, scratch) {
  const width = 2 * r + 1;
  for (let y = 0; y < n; y++) {
    const row = y * n; let sum = 0;
    for (let k = -r; k <= r; k++) sum += src[row + (k + n) % n];
    for (let x = 0; x < n; x++) {
      scratch[row + x] = sum / width;
      sum += src[row + (x + r + 1) % n] - src[row + (x - r + n) % n];
    }
  }
  for (let x = 0; x < n; x++) {
    let sum = 0;
    for (let k = -r; k <= r; k++) sum += scratch[((k + n) % n) * n + x];
    for (let y = 0; y < n; y++) {
      out[y * n + x] = sum / width;
      sum += scratch[((y + r + 1) % n) * n + x] - scratch[((y - r + n) % n) * n + x];
    }
  }
}
export function inflate(src, dst, n, growth) {
  const zoom = Math.exp(-growth), center = (n - 1) / 2;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const sx = (x - center) * zoom + center, sy = (y - center) * zoom + center;
    const ix = Math.floor(sx), iy = Math.floor(sy), fx = sx - ix, fy = sy - iy;
    const a = (iy * n + ix) * CHANNELS, b = (iy * n + (ix + 1) % n) * CHANNELS;
    const c = (((iy + 1) % n) * n + ix) * CHANNELS, d = (((iy + 1) % n) * n + (ix + 1) % n) * CHANNELS;
    const o = (y * n + x) * CHANNELS;
    for (let ch = 0; ch < CHANNELS; ch++) dst[o + ch] = (src[a + ch] * (1 - fx) + src[b + ch] * fx) * (1 - fy)
      + (src[c + ch] * (1 - fx) + src[d + ch] * fx) * fy;
  }
}
export class CPUModel {
  constructor(n, p, state) {
    if (![128, 256, 512, 1024].includes(n)) throw Error('Unsupported resolution.');
    this.n = n; this.field = state ? new Float32Array(state) : initialField(n, p);
    this.next = new Float32Array(n * n * CHANNELS); this.grown = new Float32Array(n * n * CHANNELS);
    this.scalar = new Float32Array(n * n); this.scratch = new Float32Array(n * n);
    this.activators = Array.from({ length: SCALES }, () => new Float32Array(n * n));
    this.inhibitors = Array.from({ length: SCALES }, () => new Float32Array(n * n));
    this.iteration = 0;
  }
  step(p, count = 1) {
    const n = this.n, scales = scaleConfig(p, n), coeff = coefficients(p);
    for (let t = 0; t < count; t++) {
      let src = this.field;
      if (p.growth > 0) { inflate(src, this.grown, n, p.growth); src = this.grown; }
      const dst = this.next;
      if (p.mode === 'turing') {
        const enabled = scales.some(s => s.amount > 0);
        for (let i = 0; i < n * n; i++) this.scalar[i] = src[i * CHANNELS];
        for (let s = 0; s < SCALES; s++) {
          boxBlur(this.scalar, n, scales[s].r, this.activators[s], this.scratch);
          boxBlur(this.scalar, n, scales[s].inhibitor, this.inhibitors[s], this.scratch);
          if(p.kernel==='smooth')for(let pass=0;pass<2;pass++){
            boxBlur(this.activators[s],n,scales[s].r,this.activators[s],this.scratch);
            boxBlur(this.inhibitors[s],n,scales[s].inhibitor,this.inhibitors[s],this.scratch);
          }
        }
        let lo = Infinity, hi = -Infinity;
        for (let i = 0; i < n * n; i++) {
          const j = i * CHANNELS;
          if (!enabled) { for (let ch=0; ch<CHANNELS; ch++) dst[j+ch]=src[j+ch]; continue; }
          let best = Infinity, winner = 0, delta = 0;
          const region = clamp(this.activators[5][i] * 5, -1, 1);
          for (let s = 0; s < SCALES; s++) {
            if (scales[s].amount === 0) continue;
            const d = this.activators[s][i] - this.inhibitors[s][i];
            const score = Math.abs(d) * scales[s].weight * Math.exp(-p.regionality * scales[s].gate * region);
            if (score < best) { best = score; winner = s; delta = d; }
          }
          dst[j] = src[j] + (delta > 0 ? 1 : -1) * scales[winner].amount;
          for(let s=0;s<6;s++) dst[j+1+s] = src[j+1+s]*(1-p.colorMemory) + (winner === s ? p.colorMemory : 0);
          dst[j+7] = src[j+7]*0.98 + this.activators[5][i]*0.02;
          lo = Math.min(lo, dst[j]); hi = Math.max(hi, dst[j]);
        }
        const span = Math.max(hi - lo, 1e-6);
        if(enabled) for (let i = 0; i < n * n; i++) dst[i * CHANNELS] = 2 * (dst[i * CHANNELS] - lo) / span - 1;
      } else {
        for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
          const i = (y * n + x) * CHANNELS;
          const l = (y * n + (x + n - 1) % n) * CHANNELS, r = (y * n + (x + 1) % n) * CHANNELS;
          const u = (((y + n - 1) % n) * n + x) * CHANNELS, d = (((y + 1) % n) * n + x) * CHANNELS;
          const q = Array.from({length:CHANNELS},(_,ch) => src[i + ch]);
          const lap = q.map((v, ch) => src[l + ch] + src[r + ch] + src[u + ch] + src[d + ch] - 4 * v);
          // Two concentrations plus two slow history fields; our hypothesis, not McCabe's unpublished map.
          const f = clamp(p.feed + p.coupling * coeff[0] * (q[2] - q[3]) + p.regionVariation*0.012*q[4], 0.005, 0.09);
          const k = clamp(p.kill + p.coupling * coeff[1] * (q[3] - 0.1) + p.regionVariation*(0.004*q[4]+0.003*q[5]), 0.025, 0.09);
          const uvv = q[0] * q[1] * q[1];
          dst[i] = clamp(q[0] + p.diffusion * lap[0] - uvv + f * (1 - q[0]));
          dst[i + 1] = clamp(q[1] + p.diffusion * 0.5 * lap[1] + uvv - (f + k) * q[1]);
          dst[i + 2] = clamp(q[2] + 0.03 * lap[2] + p.memory * coeff[2] * (q[1] - q[2]));
          dst[i + 3] = clamp(q[3] + 0.01 * lap[3] + p.memory * 0.25 * coeff[3] * (q[2] - q[3]));
          dst[i+4] = clamp(q[4] + 0.025*lap[4] + 0.0005*q[4]*(1-q[4]*q[4]) + 0.001*p.regionVariation*(q[1]-0.17), -1, 1);
          dst[i+5] = clamp(q[5] + 0.015*lap[5] + 0.0003*q[5]*(1-q[5]*q[5]) + 0.001*p.regionVariation*(q[2]-q[3]), -1, 1);
          dst[i+6] = q[6]*(1-p.colorMemory) + q[1]*p.colorMemory;
          dst[i+7] = q[7]*(1-p.colorMemory) + q[2]*p.colorMemory;
        }
      }
      this.next = this.field; this.field = dst; this.iteration++;
    }
  }
}
const PALETTES = {
  mineral: ['101324','25387e','4d68bd','a4d6e6','f6f4d4','dcc15d','99722d','313b32','b0a4d8','eef6f3','101324'],
  ember: ['15152b','4e315e','be4a49','ef9460','fae8b6','c4d1bb','357786','183248','15152b'],
  lagoon: ['101d22','1b5455','55a99a','a5e0c2','ecedbb','bcb965','578397','6d64a2','101d22'],
};
export function paletteStops(p) {
  const colors = PALETTES[p.palette].slice(0, -1);
  const shift = hash(p.colorSeed) % colors.length;
  const reverse = hash(p.colorSeed + 17) % 2 ? 1 : -1;
  const result = colors.map((_, i) => colors[(shift + colors.length + reverse * i) % colors.length])
    .map(c => [0, 2, 4].map(k => parseInt(c.slice(k, k + 2), 16) / 255));
  result.push(result[0]); return result;
}
const ANCHORS = {
  mineral: ['347ddd','d6bc34','8f73bd','82b2be','b4a23c','d1d8a5'],
  ember: ['c05645','e4ad71','774a94','6da798','de9367','c48cbd'],
  lagoon: ['259f93','bbb857','478bbe','82988e','9875bf','4d9164'],
};
const mix = (a,b,t) => a*(1-t)+b*t;
const smooth = (a,b,x) => { const t=clamp((x-a)/(b-a)); return t*t*(3-2*t); };
const fract = x => x-Math.floor(x);
function hsv(rgb) {
  const hi=Math.max(...rgb),lo=Math.min(...rgb),d=hi-lo;
  let h=d===0?0:hi===rgb[0]?((rgb[1]-rgb[2])/d+6)%6:hi===rgb[1]?(rgb[2]-rgb[0])/d+2:(rgb[0]-rgb[1])/d+4;
  return [h/6,hi===0?0:d/hi,hi];
}
function fromHSV(h,s,v) {
  return [5,3,1].map(n=>{const k=(n+h*6)%6;return v-v*s*Math.max(0,Math.min(k,4-k,1));});
}
export function layerRamps(p) {
  const anchors=ANCHORS[p.palette],shift=hash(p.colorSeed)%6;
  return Array.from({length:6},(_,s)=>{
    const manual=p[`layer${s+1}Color`],base=manual?.slice(1)||anchors[(s+shift)%6];
    let mid=[0,2,4].map(i=>parseInt(base.slice(i,i+2),16)/255);
    if(!manual){
      const [h,sat,v]=hsv(mid);
      mid=fromHSV(fract(h+(random(p.colorSeed+s*117+331)-.5)*.12),clamp(sat*(.85+.3*random(p.colorSeed+s*103+517))),clamp(v*(.9+.2*random(p.colorSeed+s*131+617))));
    }
    const dark=mid.map((v,c)=>v*.14+[.018,.012,.032][c]);
    const light=mid.map((v,c)=>mix(v,[1,.99,.94][c],.82));
    return { dark,mid,light,phase:(random(p.colorSeed+s*271+997)-.5)*.6 };
  });
}
export function colorPhases(p) { return [0,1,2].map(i=>random(p.colorSeed+1907*i+7723)); }
export function influenceWeights(field, i, p) {
  if(p.mode==='turing') return Array.from({length:6},(_,s)=>field[i+1+s]);
  const a=clamp(.75*field[i+4]+1.3*(field[i+6]-.2),-1,1);
  const b=clamp(.75*field[i+5]+2*(field[i+7]-.15),-1,1);
  return Array.from({length:6},(_,s)=>{
    const angle=s*Math.PI/3,dx=a-Math.cos(angle)*.7,dy=b-Math.sin(angle)*.7;
    return Math.exp(-2*(dx*dx+dy*dy));
  });
}
export function renderPixels(field, n, p) {
  const pixels = new Uint8ClampedArray(n*n*4), stops=paletteStops(p),ramps=layerRamps(p),phases=colorPhases(p);
  const height = i => p.mode==='turing'?field[i]*.5+.5:clamp(field[i+1]*2.5);
  for(let y=0;y<n;y++)for(let x=0;x<n;x++){
    const i=(y*n+x)*CHANNELS,output=(y*n+x)*4,h=height(i);
    let rgb;
    if(p.view==='field') rgb=[h,h,h];
    else if(p.view==='raw') rgb=p.mode==='lattice'?[field[i],field[i+1]*2,field[i+2]*3]:[field[i+1]+field[i+4],field[i+2]+field[i+5],field[i+3]+field[i+6]];
    else {
      const weights=influenceWeights(field,i,p);
      let total=0;
      for(let s=0;s<6;s++){weights[s]=Math.pow(Math.max(weights[s],0.00001),p.separation);total+=weights[s];}
      for(let s=0;s<6;s++)weights[s]=total>1e-30?weights[s]/total:1/6;
      const mean=weights.reduce((sum,w,s)=>sum+w*s/5,0);
      const region=p.mode==='turing'?clamp(field[i+7]*4,-1,1):field[i+4];
      const region2=p.mode==='turing'?mean*2-1:field[i+5];
      const tone=h*p.contrast+.5*(1-p.contrast);
      const legacyPhase=fract(tone*p.bands + p.colorMix*(p.mode==='turing'?mean:field[i+2]*3)+p.hue);
      const pos=legacyPhase*(stops.length-1),index=Math.floor(pos),t=smooth(0,1,fract(pos));
      const legacy=stops[index].map((v,c)=>mix(v,stops[index+1][c],t));
      if(p.view==='regions'){
        rgb=[0,1,2].map(c=>weights.reduce((sum,w,s)=>sum+w*ramps[s].mid[c],0));
      }else if(p.colorStyle==='legacy')rgb=legacy;
      else if(p.colorStyle==='spectral'){
        const tau=Math.PI*2;
        rgb=[
          .5+.5*Math.sin(tau*(tone*p.bands+p.hue+region*p.colorDrift*.31+phases[0])),
          .5+.5*Math.sin(tau*(tone*p.bands*.83+p.hue+region2*p.colorDrift*.41+phases[1])),
          .5+.5*Math.sin(tau*(tone*p.bands*1.17+p.hue+(region-region2)*p.colorDrift*.23+phases[2])),
        ];
        rgb=rgb.map((v,c)=>mix(legacy[c],v,p.colorMix));
      }else{
        rgb=[0,0,0];
        for(let s=0;s<6;s++){
          const level=.5+.5*Math.sin(Math.PI*2*(tone*p.bands+p.hue+ramps[s].phase+region*p.colorDrift*.17));
          const a=smooth(0,.55,level),b=smooth(.55,1,level);
          for(let c=0;c<3;c++)rgb[c]+=weights[s]*mix(mix(ramps[s].dark[c],ramps[s].mid[c],a),ramps[s].light[c],b);
        }
        rgb=rgb.map((v,c)=>mix(legacy[c],v,p.colorMix));
      }
      if(p.view==='color'){
        const luma=rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;
        rgb=rgb.map(v=>mix(luma,v,p.saturation));
        const dx=height((y*n+(x+1)%n)*CHANNELS)-height((y*n+(x+n-1)%n)*CHANNELS);
        const dy=height((((y+1)%n)*n+x)*CHANNELS)-height((((y+n-1)%n)*n+x)*CHANNELS);
        const light=clamp(1+p.relief*(dx-dy)*2.5,.35,1.6);rgb=rgb.map(v=>v*light);
      }
    }
    for(let c=0;c<3;c++)pixels[output+c]=clamp(rgb[c])*255;pixels[output+3]=255;
  }
  return pixels;
}
