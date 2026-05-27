const DEFAULT_SETTINGS = Object.freeze({
  hotkeys: {},
  randomDefaults: {},
  randomGraphSize: 6,
  randomBranchCount: 2,
  randomConnectedness: 2,
  randomEdgeRandomness: 0,
  randomMutationAmount: 0.35,
  randomConnectednessDefaultVersion: 2,
  export: {
    duration: 8,
    fps: 60,
    width: 1280,
    height: 720,
    videoBitsPerSecond: 24000000,
    audioBitsPerSecond: 192000
  },
  layout: {
    panes: null,
    graphZoom: null
  },
  audio: {
    deviceId: ""
  }
});

export function createDefaultSettings() {
  return structuredClone(DEFAULT_SETTINGS);
}

export function mergeSettings(base = createDefaultSettings(), override = {}) {
  return {
    ...base,
    ...override,
    hotkeys: { ...(base.hotkeys || {}), ...(override.hotkeys || {}) },
    randomDefaults: { ...(base.randomDefaults || {}), ...(override.randomDefaults || {}) },
    export: { ...(base.export || {}), ...(override.export || {}) },
    layout: { ...(base.layout || {}), ...(override.layout || {}) },
    audio: { ...(base.audio || {}), ...(override.audio || {}) }
  };
}

export function migrateSettings(settings) {
  if (!settings || typeof settings !== "object") return {};
  const next = { ...settings };
  next.layout = { ...(next.layout || {}) };
  if (next.layout.graphZoom === 1 && next.layout.graphZoomDefaultVersion !== 2) {
    next.layout.graphZoom = null;
  }
  next.layout.graphZoomDefaultVersion = 2;
  if (next.randomConnectedness === 3 && next.randomConnectednessDefaultVersion !== 2) {
    next.randomConnectedness = 2;
  }
  next.randomEdgeRandomness = clampInt(next.randomEdgeRandomness, 0, 3, 0);
  next.randomMutationAmount = clampFloat(next.randomMutationAmount, 0, 1, 0.35);
  next.randomConnectednessDefaultVersion = 2;
  return next;
}

export function cleanStateForPersistence(state, status = "Ready") {
  const clean = structuredClone(state);
  clean.ui = {
    selectedNodeIds: clean.ui?.selectedNodeIds || [],
    diagnostics: [],
    status
  };
  return clean;
}

export function readTimeScale(state) {
  const scale = Number(state.time?.scale);
  return Number.isFinite(scale) ? Math.min(3, Math.max(0, scale)) : 1;
}

function clampInt(value, min, max, fallback) {
  const numeric = Number(value);
  const safe = Number.isFinite(numeric) ? numeric : fallback;
  return Math.round(Math.min(max, Math.max(min, safe)));
}

function clampFloat(value, min, max, fallback) {
  const numeric = Number(value);
  const safe = Number.isFinite(numeric) ? numeric : fallback;
  return Math.min(max, Math.max(min, safe));
}
