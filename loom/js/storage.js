import { cleanStateForPersistence, migrateSettings } from "./settings.js";
import { normalizeGraphPorts } from "./nodes.js";

const DB_NAME = "function-generator-db";
const DB_VERSION = 1;
const PRESET_STORE = "presets";
const PROJECT_STORE = "project";
const SETTINGS_KEY = "function-generator-settings";
const AUTOSAVE_KEY = "autosave";

export class StorageManager {
  constructor(status = () => {}) {
    this.db = null;
    this.status = status;
    this.autosaveTimer = 0;
  }

  async init() {
    if (!("indexedDB" in window)) {
      this.status("IndexedDB unavailable; presets will not persist.");
      return false;
    }
    this.db = await new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(PRESET_STORE)) {
          const store = db.createObjectStore(PRESET_STORE, { keyPath: "id" });
          store.createIndex("updatedAt", "updatedAt");
        }
        if (!db.objectStoreNames.contains(PROJECT_STORE)) {
          db.createObjectStore(PROJECT_STORE, { keyPath: "id" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return true;
  }

  async savePreset(preset) {
    return this.put(PRESET_STORE, {
      ...preset,
      graph: normalizeGraphPorts(preset.graph),
      updatedAt: Date.now()
    });
  }

  async listPresets() {
    const presets = await this.getAll(PRESET_STORE);
    return presets.map(normalizePreset).sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async getPreset(id) {
    return normalizePreset(await this.get(PRESET_STORE, id));
  }

  async deletePreset(id) {
    return this.delete(PRESET_STORE, id);
  }

  async duplicatePreset(id) {
    const preset = await this.getPreset(id);
    if (!preset) return null;
    const copy = {
      ...structuredClone(preset),
      id: makeStorageId("preset"),
      name: `${preset.name} Copy`,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    await this.savePreset(copy);
    return copy;
  }

  async renamePreset(id, name) {
    const preset = await this.getPreset(id);
    if (!preset) return null;
    preset.name = name.trim() || preset.name;
    preset.updatedAt = Date.now();
    await this.savePreset(preset);
    return preset;
  }

  async saveProject(state) {
    return this.put(PROJECT_STORE, {
      id: AUTOSAVE_KEY,
      state: cleanStateForPersistence({ ...state, graph: normalizeGraphPorts(state.graph) }, "Autosaved"),
      updatedAt: Date.now()
    });
  }

  async loadProject() {
    const record = await this.get(PROJECT_STORE, AUTOSAVE_KEY);
    if (!record?.state) return null;
    return { ...record.state, graph: normalizeGraphPorts(record.state.graph) };
  }

  autosave(state) {
    if (!this.db) return;
    window.clearTimeout(this.autosaveTimer);
    this.autosaveTimer = window.setTimeout(() => {
      this.saveProject(state).catch((error) => this.status(`Autosave failed: ${error.message}`));
    }, 400);
  }

  async exportPresetPack() {
    const presets = await this.listPresets();
    return JSON.stringify({ version: 1, exportedAt: Date.now(), presets }, null, 2);
  }

  async importPresetPack(text) {
    const parsed = JSON.parse(text);
    const presets = Array.isArray(parsed.presets) ? parsed.presets : [];
    for (const preset of presets) {
      await this.savePreset({
        ...preset,
        graph: normalizeGraphPorts(preset.graph),
        id: preset.id || makeStorageId("preset"),
        createdAt: preset.createdAt || Date.now(),
        updatedAt: Date.now()
      });
    }
    return presets.length;
  }

  async ensurePresetPack(presets) {
    let imported = 0;
    for (const preset of presets) {
      if (!preset?.id) continue;
      const existing = await this.getPreset(preset.id);
      if (existing) continue;
      await this.put(PRESET_STORE, {
        ...structuredClone(preset),
        graph: normalizeGraphPorts(preset.graph),
        createdAt: preset.createdAt || Date.now(),
        updatedAt: preset.updatedAt || Date.now()
      });
      imported += 1;
    }
    return imported;
  }

  transaction(storeName, mode = "readonly") {
    if (!this.db) throw new Error("IndexedDB is not initialized.");
    return this.db.transaction(storeName, mode).objectStore(storeName);
  }

  get(storeName, key) {
    return requestToPromise(this.transaction(storeName).get(key));
  }

  getAll(storeName) {
    return requestToPromise(this.transaction(storeName).getAll());
  }

  put(storeName, value) {
    return requestToPromise(this.transaction(storeName, "readwrite").put(value));
  }

  delete(storeName, key) {
    return requestToPromise(this.transaction(storeName, "readwrite").delete(key));
  }
}

export function loadLocalSettings() {
  try {
    return migrateSettings(JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}"));
  } catch {
    return {};
  }
}

export function saveLocalSettings(settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Ignore quota or privacy-mode failures; the app remains usable.
  }
}

export function createPresetFromState(state, name, thumbnail = "") {
  return {
    id: makeStorageId("preset"),
    name: name.trim() || "Untitled Preset",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    graph: normalizeGraphPorts(state.graph),
    viewport: structuredClone(state.viewport),
    time: { ...state.time, playing: false },
    thumbnail,
    tags: []
  };
}

export function applyPresetToState(state, preset) {
  return {
    ...structuredClone(state),
    graph: normalizeGraphPorts(preset.graph),
    viewport: structuredClone(preset.viewport),
    time: { ...structuredClone(state.time), ...structuredClone(preset.time), playing: state.time.playing },
    presets: {
      ...structuredClone(state.presets),
      activeId: preset.id
    },
    ui: {
      ...structuredClone(state.ui),
      selectedNodeIds: [preset.graph.outputNodeId]
    }
  };
}

function makeStorageId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(16).slice(2)}`;
}

function normalizePreset(preset) {
  if (!preset) return preset;
  return {
    ...preset,
    graph: normalizeGraphPorts(preset.graph)
  };
}

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
