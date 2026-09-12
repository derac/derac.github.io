import { SPEC, SCALES, DEFAULTS, LAYER_FIELDS, clamp, hash, validateParams } from './model.mjs';
export const RANDOM_DEFAULTS = Object.freeze({ seed: 48621, amount: .15, structure: true, colors: true, layers: true, layerChance: .35, minLayers: 1, maxLayers: SCALES, newPattern: false });
const structure = ['scale','spacing','ratio','rate','bias','growth','regionality','colorMemory'];
const chemistry = ['feed','kill','diffusion','coupling','memory','growth','regionVariation','colorMemory'];
const colors = ['hue','bands','contrast','relief','colorMix','separation','colorDrift','saturation'];
export function changeLayers(input, selected, action) {
  const p = { ...input }, oldCount = p.layerCount;
  const mapping = Array.from({length:oldCount}, (_,i)=>i);
  if (action === 'add' && oldCount < SCALES) {
    p.layerCount++; mapping.push(-1);
    const key = `layer${p.layerCount}`;
    for (const suffix of [...Object.keys(LAYER_FIELDS),'Color']) p[key+suffix] = DEFAULTS[key+suffix];
  } else if (action === 'remove' && oldCount > 1) {
    const index = clamp(selected-1, 0, oldCount-1); mapping.splice(index,1); p.layerCount--;
    for (let i=index+1;i<=p.layerCount;i++) for (const suffix of [...Object.keys(LAYER_FIELDS),'Color']) p[`layer${i}${suffix}`] = input[`layer${i+1}${suffix}`];
  }
  return { params: validateParams(p), mapping };
}
export function randomizeParams(input, settings = RANDOM_DEFAULTS) {
  const o = { ...RANDOM_DEFAULTS, ...settings };
  if (!Number.isInteger(o.seed) || o.seed < 0 || o.seed > 0xffffffff || !Number.isFinite(o.amount) || o.amount<0 || o.amount>1 || !Number.isFinite(o.layerChance) || o.layerChance<0 || o.layerChance>1 || !Number.isInteger(o.minLayers) || !Number.isInteger(o.maxLayers) || o.minLayers<1 || o.maxLayers>SCALES || o.minLayers>o.maxLayers) throw Error('Invalid randomization settings.');
  let seed=o.seed, p={...input}, mapping=Array.from({length:p.layerCount},(_,i)=>i);
  const random=()=>{seed=hash(seed+0x9e3779b9);return seed/2**32;};
  // At most one structural edit per click, even when the current count is outside the interval.
  if(o.layers && random()<o.layerChance){
    const add=p.layerCount<=o.minLayers || (p.layerCount<o.maxLayers && random()<.5);
    if ((add && p.layerCount<o.maxLayers) || (!add && p.layerCount>o.minLayers)) {
      const changed=changeLayers(p,Math.floor(random()*p.layerCount)+1,add?'add':'remove');p=changed.params;mapping=changed.mapping;
    }
  }
  const keys = [...(o.structure ? (p.mode==='turing'?structure:chemistry) : []), ...(o.colors?colors:[])];
  if(o.layers && p.mode==='turing') for(let i=1;i<=p.layerCount;i++) for(const suffix of Object.keys(LAYER_FIELDS)) keys.push(`layer${i}${suffix}`);
  for(const key of o.amount>0?keys:[]){
    const [,lo,hi,step]=SPEC[key];
    // Local movement: no single click can traverse more than amount of the allowed range.
    const span=key==='growth'?Math.min(hi-lo,Math.max(p[key]*4,.0002)):hi-lo;
    p[key]=clamp(Math.round((p[key]+(random()*2-1)*span*o.amount)/step)*step,lo,hi);
  }
  if(o.colors && o.amount>0)for(let i=1;i<=p.layerCount;i++){
    const key=`layer${i}Color`,color=p[key];
    if(color) p[key]='#'+[1,3,5].map(k=>clamp(Math.round(parseInt(color.slice(k,k+2),16)+(random()*2-1)*255*o.amount),0,255).toString(16).padStart(2,'0')).join('');
  }
  if(o.newPattern)p.seed=Math.floor(random()*2**32);
  return { params:validateParams(p), mapping, nextSeed:hash(o.seed+1) };
}
