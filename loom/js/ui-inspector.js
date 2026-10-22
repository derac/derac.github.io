import { findNode, getNodeDefinition } from "./nodes.js";
import { writeRandomBound } from "./random.js";
import { clamp, escapeHtml } from "./ui-helpers.js";

export const inspectorControls = {
renderInspector() {
  const state = this.store.getState();
  const inspector = this.elements.inspector;
  inspector.innerHTML = "";
  const selectedId = state.ui.selectedNodeIds[0];
  const node = selectedId ? findNode(state.graph, selectedId) : null;
  const def = node ? getNodeDefinition(node.type) : null;
  if (!node || !def) {
    inspector.innerHTML = `<div class="empty-state">Select a node to edit parameters. Drag from output ports to input ports to connect nodes.</div>`;
    return;
  }
  const title = document.createElement("div");
  title.className = "field-group";
  title.innerHTML = `<div class="field-label"><span>${escapeHtml(def.label)}</span><span>${escapeHtml(def.category)}</span></div>`;
  inspector.appendChild(title);

  if (!def.params.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "This node has no editable parameters.";
    inspector.appendChild(empty);
  }
  for (const param of def.params) {
    inspector.appendChild(this.renderParamControl(node, def, param));
  }
  if (node.type === "audioInput" || node.type === "audioSplit") {
    inspector.appendChild(this.renderAudioInputControl());
  }

  const actions = document.createElement("div");
  actions.className = "small-actions";
  actions.innerHTML = `<button data-action="duplicate">Duplicate</button><button data-action="delete">Delete</button><button data-action="random">Randomize</button>`;
  actions.querySelector('[data-action="duplicate"]').addEventListener("click", () => this.duplicateSelection());
  actions.querySelector('[data-action="delete"]').addEventListener("click", () => this.deleteSelection());
  actions.querySelector('[data-action="random"]').addEventListener("click", () => this.randomSelectedNode());
  inspector.appendChild(actions);
},

renderParamControl(node, def, param) {
  const wrapper = document.createElement("div");
  wrapper.className = "field-group";
  const current = node.params[param.id] ?? param.default;
  const label = document.createElement("div");
  label.className = "field-label";
  label.innerHTML = `<span>${escapeHtml(param.label)}</span><span>${escapeHtml(String(current))}</span>`;
  wrapper.appendChild(label);

  if (param.type === "range") {
    const row = document.createElement("div");
    row.className = "field-row";
    const range = document.createElement("input");
    range.type = "range";
    range.min = param.min;
    range.max = param.max;
    range.step = param.step;
    range.value = current;
    const number = document.createElement("input");
    number.type = "number";
    number.min = param.min;
    number.max = param.max;
    number.step = param.step;
    number.value = current;
    const update = (value, history) => this.setParam(node.id, param.id, clamp(Number(value), param.min, param.max), history);
    range.addEventListener("input", () => update(range.value, false));
    range.addEventListener("change", () => this.store.commitHistory(`Set ${param.label}`));
    number.addEventListener("change", () => update(number.value, true));
    row.append(range, number);
    wrapper.appendChild(row);
    wrapper.appendChild(this.renderRandomBounds(def.type, param));
  } else if (param.type === "number") {
    const row = document.createElement("div");
    row.className = "field-row";
    const number = document.createElement("input");
    number.type = "number";
    number.min = param.min;
    number.max = param.max;
    number.step = param.step;
    number.value = current;
    number.addEventListener("change", () => this.setParam(node.id, param.id, clamp(Number(number.value), param.min, param.max), true));
    row.append(number);
    wrapper.appendChild(row);
    wrapper.appendChild(this.renderRandomBounds(def.type, param));
  } else if (param.type === "color") {
    const row = document.createElement("div");
    row.className = "field-row";
    const color = document.createElement("input");
    color.type = "color";
    color.value = current;
    color.addEventListener("input", () => this.setParam(node.id, param.id, color.value, false));
    color.addEventListener("change", () => this.store.commitHistory(`Set ${param.label}`));
    row.append(color);
    wrapper.appendChild(row);
  } else if (param.type === "toggle") {
    const row = document.createElement("div");
    row.className = "field-row";
    const toggle = document.createElement("input");
    toggle.type = "checkbox";
    toggle.checked = Boolean(current);
    toggle.addEventListener("change", () => this.setParam(node.id, param.id, toggle.checked, true));
    row.append(toggle);
    wrapper.appendChild(row);
  } else if (param.type === "select") {
    const row = document.createElement("div");
    row.className = "field-row";
    const select = document.createElement("select");
    for (const option of param.options) {
      const el = document.createElement("option");
      el.value = option.value;
      el.textContent = option.label;
      select.appendChild(el);
    }
    select.value = current;
    select.addEventListener("change", () => this.setParam(node.id, param.id, Number(select.value), true));
    row.append(select);
    wrapper.appendChild(row);
  }
  return wrapper;
},

renderRandomBounds(type, param) {
  const state = this.store.getState();
  const saved = state.settings.randomDefaults?.[type]?.[param.id] || {};
  const min = Number.isFinite(saved.min) ? saved.min : param.random?.min ?? param.min;
  const max = Number.isFinite(saved.max) ? saved.max : param.random?.max ?? param.max;
  const details = document.createElement("details");
  details.className = "random-bounds";
  details.innerHTML = `
    <summary class="empty-state">Random bounds</summary>
    <div class="field-row">
      <input type="number" data-bound="min" value="${escapeHtml(String(min))}" step="${param.step || 0.001}">
      <input type="number" data-bound="max" value="${escapeHtml(String(max))}" step="${param.step || 0.001}">
    </div>
  `;
  for (const input of details.querySelectorAll("input")) {
    input.addEventListener("change", () => {
      const bound = input.dataset.bound;
      this.store.transact("Change Random Bounds", (draft) => {
        draft.settings = writeRandomBound(draft, type, param.id, bound, input.value);
      });
    });
  }
  return details;
},

renderAudioInputControl() {
  const wrapper = document.createElement("div");
  wrapper.className = "field-group";
  const enabled = this.store.getState().audio.enabled;
  const label = document.createElement("div");
  label.className = "field-label";
  label.innerHTML = `<span>Microphone</span><span>${enabled ? "enabled" : "required"}</span>`;
  const row = document.createElement("div");
  row.className = "field-row";
  const select = document.createElement("select");
  this.fillAudioSelect(select, this.audio.devices);
  const refresh = async () => this.refreshAudioSelect(select, true);
  select.addEventListener("focus", refresh);
  select.addEventListener("pointerdown", refresh);
  select.addEventListener("change", () => this.changeAudioDevice(select.value));
  const enable = document.createElement("button");
  enable.type = "button";
  enable.textContent = enabled ? "Disable Mic" : "Enable Mic";
  enable.addEventListener("click", () => this.toggleMic(select.value));
  row.append(select, enable);
  wrapper.append(label, row);
  if (!enabled) {
    const hint = document.createElement("div");
    hint.className = "empty-state";
    hint.textContent = "Audio Input needs microphone permission before it can affect the graph.";
    wrapper.appendChild(hint);
  }
  return wrapper;
},

async toggleMic(deviceId = this.store.getState().settings.audio?.deviceId || "") {
  const enabled = this.store.getState().audio.enabled;
  if (enabled) {
    this.audio.disable();
    this.store.transact("Disable Microphone", (draft) => {
      draft.audio.enabled = false;
    });
    return false;
  }
  try {
    await this.audio.enable(deviceId);
    this.store.transact("Enable Microphone", (draft) => {
      draft.audio.enabled = true;
      draft.settings.audio = {
        ...(draft.settings.audio || {}),
        deviceId
      };
    });
    return true;
  } catch (error) {
    this.setStatus(`Microphone unavailable: ${error.message}`);
    this.store.addDiagnostic(error.message, "warn");
    return false;
  }
},

async refreshAudioSelect(select, requestPermission = false) {
  const current = this.store.getState().settings.audio?.deviceId || select.value || "";
  let devices = [];
  try {
    devices = await this.audio.listInputDevices({ requestPermission });
  } catch (error) {
    this.setStatus(`Microphone permission needed: ${error.message}`);
    devices = [];
  }
  this.fillAudioSelect(select, devices, current);
},

fillAudioSelect(select, devices = this.audio.devices, selected = this.store.getState().settings.audio?.deviceId || "") {
  const previousText = select.options[select.selectedIndex]?.textContent || "Default mic";
  select.innerHTML = "";
  const defaultOption = document.createElement("option");
  defaultOption.value = "";
  defaultOption.textContent = "Default mic";
  select.appendChild(defaultOption);
  for (const device of devices) {
    const option = document.createElement("option");
    option.value = device.deviceId;
    option.textContent = device.label;
    select.appendChild(option);
  }
  if (selected && !devices.some((device) => device.deviceId === selected)) {
    const option = document.createElement("option");
    option.value = selected;
    option.textContent = previousText === "Default mic" ? "Selected mic" : previousText;
    select.appendChild(option);
  }
  select.value = selected;
},

async changeAudioDevice(deviceId) {
  this.store.transact("Select Microphone", (draft) => {
    draft.settings.audio = { ...(draft.settings.audio || {}), deviceId };
  }, { history: false });
  try {
    await this.audio.setDevice(deviceId);
    this.setStatus(deviceId ? "Microphone input selected." : "Default microphone selected.");
  } catch (error) {
    this.setStatus(`Microphone switch failed: ${error.message}`);
    this.store.addDiagnostic(error.message, "warn");
  }
}
};
