import { createStarterGraph } from "./nodes.js";
import { cleanStateForPersistence, createDefaultSettings } from "./settings.js";

const HISTORY_LIMIT = 90;

export function createInitialState() {
  return {
    version: 1,
    graph: createStarterGraph(),
    viewport: { offsetX: 0, offsetY: 0, zoom: 1 },
    time: { playing: true, scale: 1, value: 0 },
    audio: {
      enabled: false,
      source: "microphone",
      features: { level: 0, bass: 0, mids: 0, treble: 0, focus: 0, beat: 0 }
    },
    presets: {
      activeId: null,
      cycle: {
        enabled: false,
        mode: "shuffle",
        seconds: 6,
        transitionDuration: 1.2,
        transitionType: "crossfade"
      }
    },
    settings: createDefaultSettings(),
    ui: {
      selectedNodeIds: ["node_fbm"],
      diagnostics: [],
      status: "Ready"
    }
  };
}

export function createStore(initialState = createInitialState()) {
  let state = clone(initialState);
  const listeners = new Set();
  const historyListeners = new Set();
  let thumbnailProvider = () => "";
  let history = [
    {
      id: "history_initial",
      label: "Initial graph",
      timestamp: Date.now(),
      snapshot: snapshotState(state),
      thumbnail: ""
    }
  ];
  let historyIndex = 0;

  function getState() {
    return state;
  }

  function subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  function subscribeHistory(listener) {
    historyListeners.add(listener);
    return () => historyListeners.delete(listener);
  }

  function notify(reason = "state") {
    for (const listener of listeners) listener(state, reason);
  }

  function notifyHistory() {
    const payload = { entries: history, index: historyIndex };
    for (const listener of historyListeners) listener(payload);
  }

  function transact(label, mutator, options = {}) {
    const { history: record = true, notify: shouldNotify = true } = options;
    const draft = clone(state);
    mutator(draft);
    state = draft;
    if (record) {
      pushHistory(label);
    }
    if (shouldNotify) notify(label);
  }

  function replaceState(nextState, label = "Replace State", options = {}) {
    const { history: record = true, notify: shouldNotify = true } = options;
    state = clone(nextState);
    if (record) pushHistory(label);
    if (shouldNotify) notify(label);
  }

  function patchState(label, patch, options = {}) {
    transact(label, (draft) => {
      Object.assign(draft, clone(patch));
    }, options);
  }

  function pushHistory(label = "Edit", thumbnail = safeThumbnail(), snapshot = snapshotState(state)) {
    if (historyIndex < history.length - 1) {
      history = history.slice(0, historyIndex + 1);
    }
    history.push({
      id: `history_${Date.now()}_${Math.random().toString(16).slice(2)}`,
      label,
      timestamp: Date.now(),
      snapshot,
      thumbnail
    });
    if (history.length > HISTORY_LIMIT) {
      const overflow = history.length - HISTORY_LIMIT;
      history = history.slice(overflow);
      historyIndex = Math.max(0, historyIndex - overflow);
    }
    historyIndex = history.length - 1;
    notifyHistory();
  }

  function commitHistory(label = "Edit", thumbnail = undefined) {
    pushHistory(label, thumbnail === undefined ? safeThumbnail() : thumbnail);
    notify("history");
  }

  function commitHistorySnapshot(label = "Edit", snapshot, thumbnail = "") {
    pushHistory(label, thumbnail, snapshotState(snapshot));
    notify("history");
  }

  function undo() {
    if (historyIndex <= 0) return false;
    historyIndex -= 1;
    state = clone(history[historyIndex].snapshot);
    notify("undo");
    notifyHistory();
    return true;
  }

  function redo() {
    if (historyIndex >= history.length - 1) return false;
    historyIndex += 1;
    state = clone(history[historyIndex].snapshot);
    notify("redo");
    notifyHistory();
    return true;
  }

  function restoreHistory(index) {
    if (index < 0 || index >= history.length) return false;
    historyIndex = index;
    state = clone(history[historyIndex].snapshot);
    notify("restore-history");
    notifyHistory();
    return true;
  }

  function getHistory() {
    return { entries: history, index: historyIndex };
  }

  function setThumbnailProvider(provider) {
    thumbnailProvider = provider;
  }

  function setRuntimeTime(value) {
    state.time.value = value;
  }

  function addDiagnostic(message, level = "info") {
    const log = level === "error" ? console.error : level === "warn" ? console.warn : console.info;
    log.call(console, message);
  }

  function setStatus(message) {
    if (message) console.info(message);
  }

  function safeThumbnail() {
    try {
      return thumbnailProvider() || "";
    } catch {
      return "";
    }
  }

  notifyHistory();

  return {
    getState,
    subscribe,
    subscribeHistory,
    transact,
    replaceState,
    patchState,
    commitHistory,
    commitHistorySnapshot,
    undo,
    redo,
    restoreHistory,
    getHistory,
    setThumbnailProvider,
    setRuntimeTime,
    addDiagnostic,
    setStatus
  };
}

function snapshotState(state) {
  return cleanStateForPersistence(state, state.ui?.status || "Ready");
}

function clone(value) {
  return structuredClone(value);
}
