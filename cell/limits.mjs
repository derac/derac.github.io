import { CHANNELS, SCALES } from './model.mjs';
export const MiB = 1024 * 1024;
// Live fields + scratch + both complete scale-average buffers. Reserve covers display,
// row uploads/readback, driver bookkeeping and CPU preview pixels; it is an estimate.
export function workingBytes(n, backend = 'WebGPU') {
  return Math.ceil(n * n * (3 * CHANNELS * 4 + SCALES * 16 + (backend === 'CPU worker' ? 12 : 8/256))) + 8;
}
export function reserveBytes(viewPixels = 1920 * 1080) { return 64 * MiB + viewPixels * 12; }
export function resolutionLimit({ budgetMiB = 512, currentSize = 0, backend = 'WebGPU', limits = {}, viewPixels } = {}) {
  const available = budgetMiB * MiB - reserveBytes(viewPixels) - workingBytes(currentSize, backend);
  const memory = Math.max(0, Math.floor(Math.sqrt(Math.max(0, available) / workingBytes(1, backend))));
  const binding = Math.floor(Math.sqrt(Math.min(limits.maxBufferSize ?? 2**31, limits.maxStorageBufferBindingSize ?? 2**31) / Math.max(CHANNELS * 4, SCALES * 8)));
  // u32 storage indices and implementation-accepted typed-array lengths.
  return Math.min(memory, backend === 'WebGPU' ? binding : 32768, 32768);
}
export function checkResolution(n, options) {
  const maximum = resolutionLimit(options);
  if (!Number.isInteger(n) || n < 16 || n > maximum) throw Error(`Choose a whole-number resolution from 16 to ${maximum}. Increase the memory budget for larger grids.`);
  return n;
}
export const formatBytes = bytes => bytes >= 1024*MiB ? `${(bytes/(1024*MiB)).toFixed(2)} GiB` : `${(bytes/MiB).toFixed(0)} MiB`;
