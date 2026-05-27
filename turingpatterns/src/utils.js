export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function isPowerOfTwo(value) {
  return value > 0 && (value & (value - 1)) === 0;
}

export function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export function createInitialField(size, seed) {
  const random = mulberry32(seed);
  const field = new Float32Array(size * size);
  for (let i = 0; i < field.length; i += 1) {
    field[i] = random() * 2 - 1;
  }
  return field;
}

export function createInitialColors(size) {
  const colors = new Float32Array(size * size * 4);
  for (let i = 0; i < colors.length; i += 4) {
    colors[i + 3] = 1;
  }
  return colors;
}

export function createInitialBzState(size, seed, baseFrequency = 4) {
  const random = mulberry32((seed ^ 0x85ebca6b) >>> 0);
  const structure = createLowFrequencyNoise(size, seed ^ 0xc2b2ae35, baseFrequency);
  const state = new Float32Array(size * size * 4);
  for (let i = 0; i < size * size; i += 1) {
    const n = structure[i];
    const sparkChance = 0.012 + Math.max(n, 0) * 0.018;
    const phase = random() < sparkChance ? 0.04 + random() * 0.18 : 0;
    state[i * 4] = phase;
    state[i * 4 + 1] = random() * 0.08;
    state[i * 4 + 2] = 0.48 + n * 0.22;
    state[i * 4 + 3] = Math.min(1, Math.max(0, n * 0.5 + 0.5 + (random() - 0.5) * 0.24));
  }
  return state;
}

function smoothstep(value) {
  return value * value * (3 - 2 * value);
}

function wrappedValueNoise(size, grid, frequency, x, y) {
  const gx = (x / size) * frequency;
  const gy = (y / size) * frequency;
  const x0 = Math.floor(gx) % frequency;
  const y0 = Math.floor(gy) % frequency;
  const x1 = (x0 + 1) % frequency;
  const y1 = (y0 + 1) % frequency;
  const tx = smoothstep(gx - Math.floor(gx));
  const ty = smoothstep(gy - Math.floor(gy));
  const a = grid[y0 * frequency + x0];
  const b = grid[y0 * frequency + x1];
  const c = grid[y1 * frequency + x0];
  const d = grid[y1 * frequency + x1];
  const top = a * (1 - tx) + b * tx;
  const bottom = c * (1 - tx) + d * tx;
  return top * (1 - ty) + bottom * ty;
}

export function createLowFrequencyNoise(size, seed, baseFrequency = 4) {
  const random = mulberry32((seed ^ 0x9e3779b9) >>> 0);
  const frequency = Math.max(1, Math.round(baseFrequency));
  const octaves = 4;
  const grids = [];
  for (let octave = 0; octave < octaves; octave += 1) {
    const octaveFrequency = frequency * 2 ** octave;
    const grid = new Float32Array(octaveFrequency * octaveFrequency);
    for (let i = 0; i < grid.length; i += 1) {
      grid[i] = random() * 2 - 1;
    }
    grids.push({ frequency: octaveFrequency, grid });
  }

  const noise = new Float32Array(size * size);
  let min = Infinity;
  let max = -Infinity;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let amplitude = 1;
      let totalAmplitude = 0;
      let value = 0;
      for (const octave of grids) {
        value += wrappedValueNoise(size, octave.grid, octave.frequency, x, y) * amplitude;
        totalAmplitude += amplitude;
        amplitude *= 0.5;
      }
      value /= totalAmplitude;
      const id = y * size + x;
      noise[id] = value;
      min = Math.min(min, value);
      max = Math.max(max, value);
    }
  }

  const range = Math.max(max - min, 0.000001);
  for (let i = 0; i < noise.length; i += 1) {
    noise[i] = ((noise[i] - min) / range) * 2 - 1;
  }
  return noise;
}

export function hexToRgb01(hex) {
  const normalized = /^#[0-9a-f]{6}$/i.test(hex) ? hex : "#ffffff";
  const value = Number.parseInt(normalized.slice(1), 16);
  return [
    ((value >> 16) & 255) / 255,
    ((value >> 8) & 255) / 255,
    (value & 255) / 255,
  ];
}

function kernelValue(kind, distance, radius) {
  if (kind === "circular") {
    return distance <= radius ? 1 : 0;
  }
  const sigma = Math.max(radius, 0.0001);
  return Math.exp((-0.5 * distance * distance) / (sigma * sigma));
}

export function buildDifferenceKernel(size, scale) {
  const cellCount = size * size;
  const kernel = new Float32Array(cellCount * 2);
  const radiusA = Math.max(0.5, Number(scale.activatorRadius) || 0.5);
  const radiusI = radiusA * Math.max(1.01, Number(scale.inhibitorRatio) || 2);
  const kind = scale.kernel === "circular" ? "circular" : "gaussian";
  let sumA = 0;
  let sumI = 0;

  for (let y = 0; y < size; y += 1) {
    const dy = y <= size / 2 ? y : y - size;
    for (let x = 0; x < size; x += 1) {
      const dx = x <= size / 2 ? x : x - size;
      const distance = Math.hypot(dx, dy);
      sumA += kernelValue(kind, distance, radiusA);
      sumI += kernelValue(kind, distance, radiusI);
    }
  }

  let ptr = 0;
  for (let y = 0; y < size; y += 1) {
    const dy = y <= size / 2 ? y : y - size;
    for (let x = 0; x < size; x += 1) {
      const dx = x <= size / 2 ? x : x - size;
      const distance = Math.hypot(dx, dy);
      const activator = kernelValue(kind, distance, radiusA) / sumA;
      const inhibitor = kernelValue(kind, distance, radiusI) / sumI;
      kernel[ptr] = activator - inhibitor;
      kernel[ptr + 1] = 0;
      ptr += 2;
    }
  }

  return kernel;
}

export function debounce(fn, delay = 250) {
  let timeoutId = 0;
  return (...args) => {
    window.clearTimeout(timeoutId);
    timeoutId = window.setTimeout(() => fn(...args), delay);
  };
}

export async function downloadCanvasPng(canvas, filename) {
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) {
    throw new Error("Canvas export failed.");
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
