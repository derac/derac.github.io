import { AudioManager } from "./audio.js";
import { WebGPURenderer } from "./renderer.js";
import { createInitialState, createStore } from "./state.js";
import { createDefaultSettings, mergeSettings, migrateSettings, readTimeScale } from "./settings.js";
import { applyPresetToState, loadLocalSettings, StorageManager } from "./storage.js";
import { createUI } from "./ui.js";

const DEFAULT_PRESET_PACK_URL = new URL("../assets/default-presets.json", import.meta.url);
const DEFAULT_PRESET_ID = "preset_mp0fcmlz_cc4e11d9853c58";
const DEFAULT_PRESET_NAME = "Preset 6:49:10 PM";

let store = null;
let renderer = null;
const pendingDiagnostics = [];
const storage = new StorageManager((message) => addDiagnostic(message, "warn"));
const audio = new AudioManager((message) => writeStaticStatus(message));

window.addEventListener("error", (event) => {
  addDiagnostic(event.message, "error");
});

window.addEventListener("unhandledrejection", (event) => {
  addDiagnostic(event.reason?.message || String(event.reason), "error");
});

bootstrap().catch((error) => {
  addDiagnostic(error.message, "error");
  writeStaticStatus(`Startup failed: ${error.message}`);
});

async function bootstrap() {
  writeStaticStatus("Starting app...");
  const initial = await prepareInitialState();
  store = createStore(initial);
  for (const { message, level } of pendingDiagnostics.splice(0)) {
    store.addDiagnostic(message, level);
  }
  const canvas = document.getElementById("previewCanvas");
  renderer = new WebGPURenderer(
    canvas,
    (message) => store.setStatus(message),
    (message, level = "info") => store.addDiagnostic(message, level)
  );
  const ui = createUI({ store, renderer, storage, audio });
  writeStaticStatus("Editor ready. Starting renderer...");
  startLoop(ui);
  initializeRenderer();
}

async function prepareInitialState() {
  const initial = createInitialState();
  initial.settings = mergeSettings(initial.settings, loadLocalSettings());
  const storageReady = await withTimeout(storage.init(), 5000, "IndexedDB startup timed out. Presets and autosave are disabled.").catch((error) => {
    addDiagnostic(`IndexedDB startup failed: ${error.message}`, "warn");
    return false;
  });
  if (storageReady) {
    const defaultPack = await loadDefaultPresetPack();
    const defaultPreset = findDefaultPreset(defaultPack);
    if (defaultPack.length) {
      const imported = await storage.ensurePresetPack(defaultPack).catch((error) => {
        addDiagnostic(`Default preset pack import failed: ${error.message}`, "warn");
        return 0;
      });
      if (imported) writeStaticStatus(`Loaded ${imported} default presets.`);
    }
    const autosave = await storage.loadProject().catch((error) => {
      addDiagnostic(`Autosave load failed: ${error.message}`, "warn");
      return null;
    });
    if (autosave) {
      migrateLoadedState(autosave);
      autosave.settings = mergeSettings(createDefaultSettings(), mergeSettings(autosave.settings || {}, loadLocalSettings()));
      return autosave;
    } else if (defaultPreset) {
      return applyPresetToState(initial, defaultPreset);
    }
  }
  return initial;
}

async function loadDefaultPresetPack() {
  try {
    const response = await fetch(DEFAULT_PRESET_PACK_URL);
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    const pack = await response.json();
    return Array.isArray(pack.presets) ? pack.presets : [];
  } catch (error) {
    addDiagnostic(`Default preset pack load failed: ${error.message}`, "warn");
    return [];
  }
}

function findDefaultPreset(presets) {
  return presets.find((preset) => preset.id === DEFAULT_PRESET_ID)
    || presets.find((preset) => preset.name === DEFAULT_PRESET_NAME)
    || null;
}

async function initializeRenderer() {
  const ready = await withTimeout(renderer.init(), 8000, "WebGPU startup timed out. The graph editor is available, but preview rendering is disabled.").catch((error) => {
    store.addDiagnostic(`WebGPU startup failed: ${error.message}`, "error");
    store.setStatus("WebGPU startup failed.");
    return false;
  });
  if (!ready) {
    store.setStatus("Preview renderer unavailable.");
  }
}

function startLoop(ui) {
  let last = performance.now();
  const frame = (now) => {
    let state = store.getState();
    const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
    last = now;
    if (state.time.playing) {
      store.setRuntimeTime((state.time.value || 0) + dt * readTimeScale(state));
    }
    const features = audio.update();
    ui.tick(now);
    state = store.getState();
    state.audio.features = features;
    const rendered = renderer.render(state, features, ui.getMouseWorld());
    ui.afterRender(now, rendered);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

function migrateLoadedState(state) {
  const starterFbm = state.graph?.nodes?.find((node) => node.id === "node_fbm" && node.type === "fbmNoise");
  if (starterFbm && Math.abs(Number(starterFbm.params?.speed) - 0.06) < 0.0001) {
    starterFbm.params.speed = 0.35;
  }
  migrateStarterGraph(state);
  if (state.settings) {
    state.settings = migrateSettings(state.settings);
  }
}

function migrateStarterGraph(state) {
  const legacyIds = ["node_coordinates", "node_fbm", "node_ramp", "node_output"];
  const graph = state.graph;
  if (!graph?.nodes || graph.nodes.length !== legacyIds.length) return;
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  if (!legacyIds.every((id) => nodesById.has(id))) return;
  state.graph = structuredClone(createInitialState().graph);
  state.ui = {
    ...(state.ui || {}),
    selectedNodeIds: ["node_fbm"]
  };
}

function withTimeout(promise, ms, message) {
  let timeoutId = 0;
  const timeout = new Promise((_, reject) => {
    timeoutId = window.setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => window.clearTimeout(timeoutId));
}

function writeStaticStatus(message) {
  if (store) store.setStatus(message);
  else if (message) console.info(message);
}

function addDiagnostic(message, level = "info") {
  if (store) {
    store.addDiagnostic(message, level);
  } else {
    pendingDiagnostics.push({ message, level });
    const log = level === "error" ? console.error : level === "warn" ? console.warn : console.info;
    log.call(console, message);
  }
}
