import { clamp, mulberry32 } from "./utils.js";

export const MAX_SCALES = 8;
export const RESOLUTIONS = [256, 512, 1024];

export const PRESETS = [
  {
    name: "Diatom",
    mode: "turing",
    resolution: 512,
    seed: 1337,
    stepsPerFrame: 1,
    colorEnabled: true,
    noiseStrength: 0.28,
    noiseScale: 4,
    randomness: 20,
    scales: [
      { activatorRadius: 3, inhibitorRatio: 2.1, kernel: "gaussian", amount: 0.024, weight: 1.2, symmetry: 3, color: "#36c9a7" },
      { activatorRadius: 6, inhibitorRatio: 2.15, kernel: "gaussian", amount: 0.021, weight: 1.1, symmetry: 3, color: "#57a6ff" },
      { activatorRadius: 12, inhibitorRatio: 2.25, kernel: "gaussian", amount: 0.018, weight: 1.0, symmetry: 5, color: "#f2c14e" },
      { activatorRadius: 24, inhibitorRatio: 2.35, kernel: "circular", amount: 0.015, weight: 0.92, symmetry: 7, color: "#f78166" },
      { activatorRadius: 48, inhibitorRatio: 2.45, kernel: "circular", amount: 0.012, weight: 0.86, symmetry: 9, color: "#b879ff" },
      { activatorRadius: 92, inhibitorRatio: 2.55, kernel: "gaussian", amount: 0.009, weight: 0.78, symmetry: 9, color: "#f5f1d0" },
    ],
  },
  {
    name: "Bone Music",
    mode: "turing",
    resolution: 512,
    seed: 42810,
    stepsPerFrame: 1,
    colorEnabled: true,
    noiseStrength: 0.22,
    noiseScale: 5,
    randomness: 20,
    scales: [
      { activatorRadius: 2, inhibitorRatio: 1.9, kernel: "circular", amount: 0.028, weight: 1.35, symmetry: 1, color: "#e7f2d3" },
      { activatorRadius: 5, inhibitorRatio: 2.1, kernel: "circular", amount: 0.022, weight: 1.18, symmetry: 1, color: "#91d6a4" },
      { activatorRadius: 10, inhibitorRatio: 2.25, kernel: "gaussian", amount: 0.018, weight: 1.0, symmetry: 2, color: "#58a4b0" },
      { activatorRadius: 22, inhibitorRatio: 2.35, kernel: "gaussian", amount: 0.014, weight: 0.88, symmetry: 4, color: "#d8a657" },
      { activatorRadius: 44, inhibitorRatio: 2.5, kernel: "gaussian", amount: 0.011, weight: 0.78, symmetry: 4, color: "#e06c75" },
      { activatorRadius: 88, inhibitorRatio: 2.75, kernel: "circular", amount: 0.008, weight: 0.7, symmetry: 8, color: "#f1f1e8" },
    ],
  },
  {
    name: "Cells",
    mode: "turing",
    resolution: 512,
    seed: 90219,
    stepsPerFrame: 2,
    colorEnabled: true,
    noiseStrength: 0.18,
    noiseScale: 3,
    randomness: 20,
    scales: [
      { activatorRadius: 4, inhibitorRatio: 1.8, kernel: "gaussian", amount: 0.026, weight: 1.25, symmetry: 1, color: "#00c2a8" },
      { activatorRadius: 9, inhibitorRatio: 2.0, kernel: "gaussian", amount: 0.021, weight: 1.05, symmetry: 1, color: "#7bdff2" },
      { activatorRadius: 18, inhibitorRatio: 2.15, kernel: "circular", amount: 0.016, weight: 0.92, symmetry: 3, color: "#f7d06b" },
      { activatorRadius: 36, inhibitorRatio: 2.3, kernel: "circular", amount: 0.012, weight: 0.82, symmetry: 6, color: "#ff8fab" },
    ],
  },
  {
    name: "Cellularity",
    mode: "bz",
    resolution: 512,
    seed: 77291,
    stepsPerFrame: 3,
    colorEnabled: true,
    noiseStrength: 0.46,
    noiseScale: 3,
    randomness: 20,
    scales: [
      { activatorRadius: 2, inhibitorRatio: 2.1, kernel: "circular", amount: 0.018, weight: 1.25, symmetry: 1, color: "#2dd4bf" },
      { activatorRadius: 4, inhibitorRatio: 2.2, kernel: "circular", amount: 0.016, weight: 1.1, symmetry: 1, color: "#60a5fa" },
      { activatorRadius: 8, inhibitorRatio: 2.25, kernel: "gaussian", amount: 0.014, weight: 0.96, symmetry: 1, color: "#fbbf24" },
      { activatorRadius: 16, inhibitorRatio: 2.35, kernel: "gaussian", amount: 0.011, weight: 0.84, symmetry: 1, color: "#fb7185" },
      { activatorRadius: 32, inhibitorRatio: 2.5, kernel: "circular", amount: 0.008, weight: 0.72, symmetry: 1, color: "#f8fafc" },
    ],
  },
  {
    name: "McCabe Study",
    mode: "bz",
    resolution: 512,
    seed: 364210,
    stepsPerFrame: 4,
    colorEnabled: true,
    noiseStrength: 0.72,
    noiseScale: 2.4,
    randomness: 20,
    scales: [
      { activatorRadius: 1.4, inhibitorRatio: 1.7, kernel: "circular", amount: 0.024, weight: 1.55, symmetry: 1, color: "#ff2f8f" },
      { activatorRadius: 2.6, inhibitorRatio: 1.95, kernel: "circular", amount: 0.021, weight: 1.32, symmetry: 1, color: "#7cff2b" },
      { activatorRadius: 5, inhibitorRatio: 2.2, kernel: "gaussian", amount: 0.017, weight: 1.08, symmetry: 1, color: "#ffe438" },
      { activatorRadius: 9, inhibitorRatio: 2.45, kernel: "gaussian", amount: 0.014, weight: 0.92, symmetry: 1, color: "#32d7ff" },
      { activatorRadius: 17, inhibitorRatio: 2.65, kernel: "circular", amount: 0.011, weight: 0.82, symmetry: 1, color: "#ff6b22" },
      { activatorRadius: 32, inhibitorRatio: 2.85, kernel: "gaussian", amount: 0.008, weight: 0.72, symmetry: 1, color: "#335cff" },
      { activatorRadius: 58, inhibitorRatio: 3.1, kernel: "circular", amount: 0.006, weight: 0.64, symmetry: 1, color: "#f7fff0" },
      { activatorRadius: 104, inhibitorRatio: 3.35, kernel: "gaussian", amount: 0.004, weight: 0.58, symmetry: 1, color: "#1b0b3a" },
    ],
  },
];

const DEFAULT_SCALE = {
  activatorRadius: 16,
  inhibitorRatio: 2.2,
  kernel: "gaussian",
  amount: 0.016,
  weight: 1,
  symmetry: 1,
  color: "#ffffff",
};

export function cloneConfig(config) {
  return JSON.parse(JSON.stringify(config));
}

export function sanitizeScale(scale) {
  const merged = { ...DEFAULT_SCALE, ...scale };
  return {
    activatorRadius: clamp(Number(merged.activatorRadius) || DEFAULT_SCALE.activatorRadius, 0.5, 512),
    inhibitorRatio: clamp(Number(merged.inhibitorRatio) || DEFAULT_SCALE.inhibitorRatio, 1.01, 6),
    kernel: merged.kernel === "circular" ? "circular" : "gaussian",
    amount: clamp(Number(merged.amount) || 0, -0.2, 0.2),
    weight: clamp(Number(merged.weight) || DEFAULT_SCALE.weight, 0.01, 10),
    symmetry: Math.round(clamp(Number(merged.symmetry) || 1, 1, 16)),
    color: /^#[0-9a-f]{6}$/i.test(merged.color) ? merged.color : DEFAULT_SCALE.color,
  };
}

export function sanitizeConfig(config) {
  const fallback = PRESETS[0];
  const resolution = RESOLUTIONS.includes(Number(config?.resolution))
    ? Number(config.resolution)
    : fallback.resolution;
  const scales = Array.isArray(config?.scales) && config.scales.length > 0
    ? config.scales.slice(0, MAX_SCALES).map(sanitizeScale)
    : fallback.scales.map(sanitizeScale);

  return {
    name: String(config?.name || fallback.name).slice(0, 48),
    mode: config?.mode === "bz" ? "bz" : "turing",
    resolution,
    seed: Math.floor(clamp(Number(config?.seed) || fallback.seed, 0, 4294967295)),
    stepsPerFrame: Math.round(clamp(Number(config?.stepsPerFrame) || fallback.stepsPerFrame, 1, 12)),
    colorEnabled: config?.colorEnabled !== false,
    noiseStrength: clamp(Number(config?.noiseStrength ?? fallback.noiseStrength) || 0, 0, 1),
    noiseScale: clamp(Number(config?.noiseScale ?? fallback.noiseScale) || fallback.noiseScale, 1, 16),
    randomness: clamp(Number(config?.randomness ?? fallback.randomness) || 0, 0, 60),
    scales,
  };
}

function jitterValue(random, value, percent, min, max) {
  const factor = 1 + (random() * 2 - 1) * percent;
  return clamp(value * factor, min, max);
}

function jitterColor(random, hex, percent) {
  const normalized = /^#[0-9a-f]{6}$/i.test(hex) ? hex : "#ffffff";
  const value = Number.parseInt(normalized.slice(1), 16);
  const channels = [
    (value >> 16) & 255,
    (value >> 8) & 255,
    value & 255,
  ].map((channel) => {
    const shifted = channel + (random() * 2 - 1) * 255 * percent;
    const lifted = shifted + 255 * percent * 0.35;
    return Math.round(clamp(lifted, 0, 255));
  });
  return `#${channels.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

export function randomizeConfig(config, seed = Math.floor(Math.random() * 4294967295)) {
  const sanitized = sanitizeConfig({ ...config, seed });
  const amount = sanitized.randomness / 100;
  const random = mulberry32(seed ^ 0xa5a5f00d);
  return sanitizeConfig({
    ...sanitized,
    seed,
    noiseStrength: jitterValue(random, sanitized.noiseStrength, amount * 0.6, 0, 1),
    noiseScale: jitterValue(random, sanitized.noiseScale, amount * 0.7, 1, 16),
    scales: sanitized.scales.map((scale) => sanitizeScale({
      ...scale,
      activatorRadius: jitterValue(random, scale.activatorRadius, amount, 0.5, 512),
      inhibitorRatio: jitterValue(random, scale.inhibitorRatio, amount * 0.75, 1.01, 6),
      amount: jitterValue(random, scale.amount, amount, -0.2, 0.2),
      weight: jitterValue(random, scale.weight, amount, 0.01, 10),
      symmetry: scale.symmetry,
      kernel: random() < amount * 0.18 ? (scale.kernel === "gaussian" ? "circular" : "gaussian") : scale.kernel,
      color: jitterColor(random, scale.color, amount),
    })),
  });
}

export function newScaleFromLast(scales) {
  const source = scales.at(-1) || DEFAULT_SCALE;
  return sanitizeScale({
    ...source,
    activatorRadius: Math.min(source.activatorRadius * 1.6, 256),
    symmetry: source.symmetry,
  });
}

export function encodeConfig(config) {
  const json = JSON.stringify(sanitizeConfig(config));
  const bytes = new TextEncoder().encode(json);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

export function decodeConfig(encoded) {
  if (!encoded) {
    return null;
  }
  try {
    const padded = encoded.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(encoded.length / 4) * 4, "=");
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    const json = new TextDecoder().decode(bytes);
    return sanitizeConfig(JSON.parse(json));
  } catch {
    return null;
  }
}

export function configFromUrl() {
  return decodeConfig(new URLSearchParams(window.location.search).get("config"));
}

export function writeConfigToUrl(config) {
  const url = new URL(window.location.href);
  url.searchParams.set("config", encodeConfig(config));
  window.history.replaceState(null, "", url);
  return url.href;
}
