export const DEFAULT_HOTKEYS = Object.freeze({
  undo: "Ctrl+Z",
  redo: "Ctrl+Shift+Z",
  playPause: "Space",
  addNode: "A",
  deleteSelection: "Delete",
  duplicateSelection: "Ctrl+D",
  randomGraph: "R",
  randomizeParameters: "Shift+R",
  savePreset: "Ctrl+S",
  exportPng: "Ctrl+Shift+I",
  exportWebm: "Ctrl+Shift+V",
  toggleFullscreenPreview: "F",
  fitGraph: "Shift+F",
  resetPreview: "Home",
  help: "?"
});

export const COMMAND_LABELS = Object.freeze({
  undo: "Undo",
  redo: "Redo",
  playPause: "Play / Pause",
  addNode: "Add Selected Node Type",
  deleteSelection: "Delete Selection",
  duplicateSelection: "Duplicate Selection",
  randomGraph: "Random Graph",
  randomizeParameters: "Randomize Parameters and Edges",
  savePreset: "Save Preset",
  exportPng: "Export PNG",
  exportWebm: "Export WebM",
  toggleFullscreenPreview: "Fullscreen Preview",
  fitGraph: "Fit Graph",
  resetPreview: "Reset Preview",
  help: "Open Help"
});

export class HotkeyManager {
  constructor(settings, actions, status = () => {}) {
    this.settings = settings || {};
    this.actions = actions;
    this.status = status;
    this.bindings = { ...DEFAULT_HOTKEYS, ...this.settings };
    this.capturing = null;
    this.handler = this.handleKeyDown.bind(this);
    document.addEventListener("keydown", this.handler);
  }

  destroy() {
    document.removeEventListener("keydown", this.handler);
  }

  setBinding(command, combo) {
    const conflict = Object.entries(this.bindings).find(([key, value]) => key !== command && value === combo);
    if (conflict) {
      this.status(`${combo} was moved from ${COMMAND_LABELS[conflict[0]]} to ${COMMAND_LABELS[command]}.`);
      this.bindings[conflict[0]] = "";
    }
    this.bindings[command] = combo;
    this.settings[command] = combo;
  }

  reset() {
    this.bindings = { ...DEFAULT_HOTKEYS };
    for (const key of Object.keys(this.settings)) delete this.settings[key];
  }

  handleKeyDown(event) {
    if (this.capturing) {
      event.preventDefault();
      event.stopPropagation();
      const combo = comboFromEvent(event);
      if (combo) {
        const command = this.capturing;
        this.capturing = null;
        this.setBinding(command, combo);
        this.actions.hotkeyChanged?.(command, combo);
      }
      return;
    }
    const editingText = isTextEditingTarget(document.activeElement);
    const combo = comboFromEvent(event);
    const command = Object.keys(this.bindings).find((key) => this.bindings[key] === combo);
    if (!command || editingText && !event.ctrlKey && !event.metaKey) return;
    const action = this.actions[command];
    if (action) {
      event.preventDefault();
      action(event);
    }
  }
}

function isTextEditingTarget(active) {
  if (!active) return false;
  if (active.tagName === "TEXTAREA" || active.tagName === "SELECT") return true;
  if (active.tagName !== "INPUT") return false;
  const type = String(active.type || "text").toLowerCase();
  return ["email", "number", "password", "search", "tel", "text", "url"].includes(type);
}

function comboFromEvent(event) {
  const parts = [];
  if (event.ctrlKey || event.metaKey) parts.push("Ctrl");
  if (event.altKey) parts.push("Alt");
  if (event.shiftKey) parts.push("Shift");
  const key = normalizeKey(event.key);
  if (!key) return "";
  if (!["Control", "Alt", "Shift", "Meta"].includes(key)) parts.push(key);
  return parts.join("+");
}

function normalizeKey(key) {
  if (key === " ") return "Space";
  if (key === "Esc") return "Escape";
  if (key.length === 1) return key.toUpperCase();
  return key;
}
