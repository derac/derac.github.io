import { CHANNELS, SCALES } from './model.mjs';
export const MiB = 1024 * 1024;
const bytesPerPixel = backend => 3 * CHANNELS * 4 + SCALES * 16 + (backend === 'CPU worker' ? 12 : 8/256);
// Includes complete live fields and scratch buffers; the reserve covers display,
// bounded uploads/readback and driver overhead. This is not a free-memory query.
export function workingBytes(n, backend = 'WebGPU') {
  return Math.ceil(n * n * bytesPerPixel(backend)) + 8;
}
export function reserveBytes(viewPixels = 1920 * 1080) { return 64 * MiB + viewPixels * 12; }
export function deviceResolutionLimit({backend = 'WebGPU', limits = {}} = {}) {
  if(backend !== 'WebGPU')return 32768;
  if((limits.maxTextureArrayLayers ?? 256)<SCALES)return 0;
  // Only the tiny extrema reduction is a storage buffer now. Large fields live
  // in texture arrays, so the browser's 128 MiB binding limit no longer caps n.
  const reduction = Math.floor(Math.sqrt(Math.floor(Math.min(limits.maxBufferSize ?? 256*MiB, limits.maxStorageBufferBindingSize ?? 128*MiB)/8)*256));
  const indexing = Math.floor(Math.sqrt(0xffffffff/SCALES));
  return Math.min(limits.maxTextureDimension2D ?? 8192,reduction,indexing);
}
export function resolutionLimits({budgetMiB = 512, currentSize = 0, backend = 'WebGPU', limits = {}, viewPixels} = {}) {
  const available = budgetMiB * MiB - reserveBytes(viewPixels) - workingBytes(currentSize,backend) - 8;
  const memory = Math.max(0,Math.floor(Math.sqrt(Math.max(0,available)/bytesPerPixel(backend))));
  const device = deviceResolutionLimit({backend,limits});
  return {maximum:Math.min(memory,device),memory,device,bottleneck:memory<device?'budget':'device'};
}
export const resolutionLimit = options => resolutionLimits(options).maximum;
export function budgetNeededMiB(n,{currentSize=0,backend='WebGPU',viewPixels}={}) {
  return Math.ceil((workingBytes(n,backend)+workingBytes(currentSize,backend)+reserveBytes(viewPixels))/MiB);
}
export function memoryBudgetRange(options={},deviceMemoryGiB) {
  if(options.backend==='CPU worker'){
    // deviceMemory is rounded system RAM, not VRAM or available memory. Use it only
    // as a conservative slider guide. Exact numeric budgets remain editable.
    const reported=Number.isFinite(deviceMemoryGiB)&&deviceMemoryGiB>0;
    return {min:128,max:Math.max(512,reported?Math.floor(deviceMemoryGiB*1024/2/64)*64:4096),source:reported?'ram':'fallback'};
  }
  const ceiling=deviceResolutionLimit(options);
  return {min:128,max:Math.max(128,Math.ceil(budgetNeededMiB(ceiling,options)/64)*64),source:'gpu'};
}
export const budgetSliderSteps = maximum => Math.max(0,Math.ceil((maximum-128)/64));
export function sliderToBudget(position,maximum) {
  return Math.max(128,Math.min(maximum,128+Math.round(position)*64));
}
export function budgetToSlider(budget,maximum) {
  return Math.max(0,Math.min(budgetSliderSteps(maximum),Math.round((budget-128)/64)));
}
export function checkResolution(n,options) {
  const {maximum,bottleneck}=resolutionLimits(options);
  if(!Number.isInteger(n)||n<16||n>maximum)throw Error(`Choose a whole-number resolution from 16 to ${maximum}. ${bottleneck==='budget'?'Increase the memory budget for larger grids.':'The backend address limit is reached; more budget will not increase this limit.'}`);
  return n;
}
export const formatBytes = bytes => bytes >= 1024*MiB ? `${(bytes/(1024*MiB)).toFixed(2)} GiB` : `${(bytes/MiB).toFixed(0)} MiB`;

// Retain an expanded scale when the budget or current allocation decreases.
export const extendBudgetSlider = (previous,guide,budget) => Math.max(previous,guide,Math.ceil(budget/64)*64);
