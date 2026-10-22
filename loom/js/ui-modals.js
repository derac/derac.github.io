import { exportPng, exportWebm, downloadText, readFileAsText } from "./export.js";
import { COMMAND_LABELS, DEFAULT_HOTKEYS } from "./hotkeys.js";
import { getNodeTypes } from "./nodes.js";
import { applyPresetToState, createPresetFromState } from "./storage.js";
import { button, categorySlug, escapeHtml, exportNumberRow, nextAnimationFrame, setText, shuffle, waitForSubmittedFrame } from "./ui-helpers.js";

export const modalControls = {
async savePreset() {
  const name = window.prompt("Preset name", `Preset ${new Date().toLocaleTimeString()}`);
  if (name === null) return;
  const preset = createPresetFromState(this.store.getState(), name, this.captureThumbnail());
  try {
    await this.storage.savePreset(preset);
    this.setStatus(`Saved preset: ${preset.name}`);
  } catch (error) {
    this.setStatus(`Preset save failed: ${error.message}`);
  }
},

async openPresets() {
  const body = document.createElement("div");
  body.appendChild(this.renderCycleControls());
  const grid = document.createElement("div");
  grid.className = "modal-grid";
  body.appendChild(grid);
  const presets = await this.storage.listPresets().catch((error) => {
    this.setStatus(`Preset list failed: ${error.message}`);
    return [];
  });
  if (!presets.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "No presets saved yet.";
    grid.appendChild(empty);
  }
  for (const preset of presets) {
    grid.appendChild(this.renderPresetCard(preset));
  }
  const actions = document.createElement("div");
  actions.className = "modal-actions";
  const exportBtn = button("Export Pack", async () => {
    const json = await this.storage.exportPresetPack();
    downloadText(json, `field-loom-presets-${Date.now()}.json`);
  });
  const importLabel = document.createElement("label");
  importLabel.className = "primary-btn";
  importLabel.style.display = "inline-grid";
  importLabel.style.placeItems = "center";
  importLabel.style.height = "30px";
  importLabel.style.borderRadius = "6px";
  importLabel.style.padding = "0 10px";
  importLabel.textContent = "Import Pack";
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "application/json,.json";
  input.hidden = true;
  input.addEventListener("change", async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      const count = await this.storage.importPresetPack(await readFileAsText(file));
      this.setStatus(`Imported ${count} presets.`);
      this.closeModal();
      this.openPresets();
    } catch (error) {
      this.setStatus(`Import failed: ${error.message}`);
    }
  });
  importLabel.appendChild(input);
  actions.append(exportBtn, importLabel);
  body.prepend(actions);
  this.showModal("Presets", body);
},

renderPresetCard(preset) {
  const card = document.createElement("div");
  card.className = "preset-card";
  const img = document.createElement("img");
  if (preset.thumbnail) img.src = preset.thumbnail;
  const body = document.createElement("div");
  body.className = "preset-card-body";
  const title = document.createElement("div");
  title.className = "preset-title";
  title.textContent = preset.name;
  const actions = document.createElement("div");
  actions.className = "preset-actions";
  actions.append(
    button("Load", () => this.loadPreset(preset)),
    button("Rename", async () => {
      const name = window.prompt("Preset name", preset.name);
      if (name !== null) {
        await this.storage.renamePreset(preset.id, name);
        this.closeModal();
        this.openPresets();
      }
    }),
    button("Copy", async () => {
      await this.storage.duplicatePreset(preset.id);
      this.closeModal();
      this.openPresets();
    }),
    button("Delete", async () => {
      if (window.confirm(`Delete ${preset.name}?`)) {
        await this.storage.deletePreset(preset.id);
        this.closeModal();
        this.openPresets();
      }
    })
  );
  body.append(title, actions);
  card.append(img, body);
  return card;
},

renderCycleControls() {
  const state = this.store.getState();
  const cycle = state.presets.cycle;
  const wrap = document.createElement("div");
  wrap.className = "field-group";
  wrap.dataset.cycleRoot = "true";
  wrap.innerHTML = `
    <div class="field-label"><span>Preset Cycling</span><span data-cycle-status>${cycle.enabled ? "enabled" : "disabled"}</span></div>
    <div class="field-row">
      <select data-cycle="mode">
        <option value="shuffle">Shuffle Bag</option>
        <option value="sequential">Sequential</option>
      </select>
      <button data-cycle-action="toggle" class="icon-btn ${cycle.enabled ? "primary-btn" : ""}" title="${cycle.enabled ? "Pause Preset Cycling" : "Start Preset Cycling"}" aria-label="${cycle.enabled ? "Pause Preset Cycling" : "Start Preset Cycling"}">${cycle.enabled ? "⏸️" : "▶️"}</button>
    </div>
    <div class="field-row">
      <input type="number" min="1" max="300" step="0.5" data-cycle="seconds" value="${cycle.seconds}">
      <input type="number" min="0" max="20" step="0.1" data-cycle="transitionDuration" value="${cycle.transitionDuration}">
    </div>
    <div class="field-row">
      <select data-cycle="transitionType">
        <option value="crossfade">Crossfade</option>
        <option value="fadeBlack">Fade Black</option>
        <option value="wipe">Wipe</option>
        <option value="dissolve">Dissolve</option>
      </select>
    </div>
  `;
  wrap.querySelector('[data-cycle="mode"]').value = cycle.mode;
  wrap.querySelector('[data-cycle="transitionType"]').value = cycle.transitionType;
  for (const input of wrap.querySelectorAll("[data-cycle]")) {
    input.addEventListener("change", () => {
      this.store.transact("Change Preset Cycle", (draft) => {
        const key = input.dataset.cycle;
        draft.presets.cycle[key] = input.type === "number" ? Number(input.value) : input.value;
        this.cycle.nextAt = performance.now() + draft.presets.cycle.seconds * 1000;
      });
    });
  }
  wrap.querySelector("[data-cycle-action]").addEventListener("click", () => this.toggleCycle());
  this.renderCycleState(cycle);
  return wrap;
},

renderCycleState(cycle = this.store.getState().presets.cycle) {
  const enabled = Boolean(cycle.enabled);
  const label = enabled ? "Pause Preset Cycling" : "Start Preset Cycling";
  setText(this.elements.cycleBtn, enabled ? "⏸️" : "▶️");
  if (this.elements.cycleBtn) {
    this.elements.cycleBtn.title = label;
    this.elements.cycleBtn.setAttribute("aria-label", label);
    this.elements.cycleBtn.classList.toggle("active", enabled);
  }
  for (const root of this.elements.modalRoot.querySelectorAll("[data-cycle-root]")) {
    const status = root.querySelector("[data-cycle-status]");
    const toggle = root.querySelector("[data-cycle-action]");
    if (status) status.textContent = enabled ? "enabled" : "disabled";
    if (toggle) {
      toggle.textContent = enabled ? "⏸️" : "▶️";
      toggle.title = label;
      toggle.setAttribute("aria-label", label);
      toggle.classList.toggle("primary-btn", enabled);
    }
  }
},

async loadPreset(preset, recordHistory = true) {
  if (this.isSwitchDrawPending()) return;
  await this.renderer.beginTransitionFromCanvas(this.store.getState().presets.cycle.transitionType, this.store.getState().presets.cycle.transitionDuration * 1000);
  if (this.isSwitchDrawPending()) return;
  this.store.replaceState(applyPresetToState(this.store.getState(), preset), `Load ${preset.name}`, { history: false });
  if (recordHistory) this.deferSwitchHistory(`Load ${preset.name}`, this.store.getState());
  requestAnimationFrame(() => this.fitGraphToViewportWidth());
  this.closeModal();
},

toggleCycle() {
  const now = performance.now();
  this.store.transact("Toggle Preset Cycle", (draft) => {
    draft.presets.cycle.enabled = !draft.presets.cycle.enabled;
    this.cycle.nextAt = now + draft.presets.cycle.seconds * 1000;
    this.cycle.bag = [];
  });
},

async tick(now) {
  const state = this.store.getState();
  if (!state.presets.cycle.enabled || this.cycle.busy || this.isSwitchDrawPending() || now < this.cycle.nextAt) return;
  this.cycle.busy = true;
  try {
    this.cycle.presets = await this.storage.listPresets();
    if (this.cycle.presets.length < 2) {
      this.setStatus("Save at least two presets before cycling.");
      this.cycle.nextAt = now + 3000;
      return;
    }
    const next = this.nextPreset(state);
    if (next) {
      await this.renderer.beginTransitionFromCanvas(state.presets.cycle.transitionType, state.presets.cycle.transitionDuration * 1000);
      if (this.isSwitchDrawPending()) return;
      this.store.replaceState(applyPresetToState(this.store.getState(), next), `Cycle ${next.name}`, { history: false });
      this.deferSwitchHistory(`Cycle ${next.name}`, this.store.getState());
      requestAnimationFrame(() => this.fitGraphToViewportWidth());
    }
    this.cycle.nextAt = now + state.presets.cycle.seconds * 1000;
  } finally {
    this.cycle.busy = false;
  }
},

nextPreset(state) {
  const presets = this.cycle.presets;
  if (state.presets.cycle.mode === "sequential") {
    const current = presets.findIndex((preset) => preset.id === state.presets.activeId);
    return presets[(current + 1 + presets.length) % presets.length];
  }
  if (!this.cycle.bag.length) {
    this.cycle.bag = shuffle(presets.map((preset) => preset.id));
  }
  let nextId = this.cycle.bag.shift();
  if (nextId === state.presets.activeId && this.cycle.bag.length) {
    this.cycle.bag.push(nextId);
    nextId = this.cycle.bag.shift();
  }
  return presets.find((preset) => preset.id === nextId) || presets[0];
},

async exportPng(options = {}) {
  try {
    await exportPng(this.elements.previewCanvas, (message) => this.setStatus(message), options);
  } catch (error) {
    this.setStatus(`PNG export failed: ${error.message}`);
  }
},

async exportWebm(options = null) {
  if (!options) {
    this.openExport("video");
    return;
  }
  const state = this.store.getState();
  const duration = Number(options.duration || state.settings.export.duration || 8);
  if (!duration) return;
  const fps = Number(options.fps || state.settings.export.fps || 60);
  if (!fps) return;
  if (options.includeMic && !state.audio.enabled && window.confirm("Enable microphone audio for this WebM recording?")) {
    await this.toggleMic(state.settings.audio?.deviceId || "");
  }
  const audioStream = options.includeMic ? this.audio.getRecordingStream() : null;
  const videoBitsPerSecond = Number(options.videoBitsPerSecond || state.settings.export.videoBitsPerSecond) || 24000000;
  const audioBitsPerSecond = Number(options.audioBitsPerSecond || state.settings.export.audioBitsPerSecond) || 192000;
  this.store.transact("Change Export Defaults", (draft) => {
    draft.settings.export.duration = duration;
    draft.settings.export.fps = fps;
    draft.settings.export.videoBitsPerSecond = videoBitsPerSecond;
    draft.settings.export.audioBitsPerSecond = audioBitsPerSecond;
    draft.settings.export.includeMic = Boolean(options.includeMic);
  }, { history: false });
  try {
    await exportWebm(this.elements.previewCanvas, {
      duration,
      fps,
      audioStream,
      videoBitsPerSecond,
      audioBitsPerSecond
    }, (message) => this.setStatus(message));
  } catch (error) {
    this.setStatus(`WebM export failed: ${error.message}`);
  }
},

openExport(initialTab = "image") {
  const body = document.createElement("div");
  body.className = "export-modal";
  const tabs = document.createElement("div");
  tabs.className = "export-tabs";
  const imageTab = button("Image", () => render("image"));
  const videoTab = button("Video", () => render("video"));
  const pane = document.createElement("div");
  pane.className = "export-pane";
  tabs.append(imageTab, videoTab);
  body.append(tabs, pane);

  const render = (tab) => {
    imageTab.classList.toggle("active", tab === "image");
    videoTab.classList.toggle("active", tab === "video");
    pane.innerHTML = "";
    if (tab === "image") this.renderImageExportPane(pane);
    else this.renderVideoExportPane(pane);
  };

  this.showModal("Export", body);
  render(initialTab);
},

renderImageExportPane(pane) {
  const currentWidth = this.elements.previewCanvas.width || Math.round(this.elements.previewCanvas.clientWidth);
  const currentHeight = this.elements.previewCanvas.height || Math.round(this.elements.previewCanvas.clientHeight);
  pane.innerHTML = `
    <div class="field-group">
      <div class="field-label"><span>PNG Image</span><span>${currentWidth} x ${currentHeight}</span></div>
      <div class="empty-state">Exports the current rendered canvas size.</div>
      <div class="modal-actions">
        <button data-export-action="png" class="primary-btn">Export PNG</button>
      </div>
    </div>
  `;
  pane.querySelector("[data-export-action='png']").addEventListener("click", async () => {
    await this.exportPng();
    this.closeModal();
  });
},

renderVideoExportPane(pane) {
  const settings = this.store.getState().settings.export || {};
  const duration = Number(settings.duration) || 8;
  const fps = Number(settings.fps) || 60;
  const videoMbps = Math.round((Number(settings.videoBitsPerSecond) || 24000000) / 100000) / 10;
  const audioKbps = Math.round((Number(settings.audioBitsPerSecond) || 192000) / 1000);
  pane.innerHTML = `
    <div class="field-group export-form">
      <div class="field-label"><span>WebM Video</span><span>Current canvas</span></div>
      ${exportNumberRow("Duration (seconds)", "data-export-duration", duration, "1", "300", "0.5")}
      ${exportNumberRow("Frames per second", "data-export-fps", fps, "1", "120", "1")}
      ${exportNumberRow("Video bitrate (Mbps)", "data-export-video", videoMbps, "1", "80", "0.5")}
      ${exportNumberRow("Audio bitrate (kbps)", "data-export-audio", audioKbps, "32", "320", "16")}
      <label class="toggle-row">
        <input type="checkbox" data-export-mic ${settings.includeMic ? "checked" : ""}>
        <span>Include microphone audio</span>
      </label>
      <div class="modal-actions">
        <button data-export-action="webm" class="primary-btn">Record WebM</button>
      </div>
    </div>
  `;
  pane.querySelector("[data-export-action='webm']").addEventListener("click", async () => {
    const options = {
      duration: Number(pane.querySelector("[data-export-duration]").value),
      fps: Number(pane.querySelector("[data-export-fps]").value),
      videoBitsPerSecond: Math.round(Number(pane.querySelector("[data-export-video]").value) * 1000000),
      audioBitsPerSecond: Math.round(Number(pane.querySelector("[data-export-audio]").value) * 1000),
      includeMic: pane.querySelector("[data-export-mic]").checked
    };
    await this.exportWebm(options);
    this.closeModal();
  });
},

openNodePalette(position, config = {}) {
  const {
    title = "Create Node",
    options = null,
    emptyText = "No matching nodes.",
    onChoose = null
  } = config;
  const body = document.createElement("div");
  body.className = "node-palette";
  const search = document.createElement("input");
  search.className = "node-palette-search";
  search.type = "search";
  search.placeholder = "Search nodes";
  body.appendChild(search);
  const groups = document.createElement("div");
  groups.className = "node-palette";
  body.appendChild(groups);

  const render = () => {
    groups.innerHTML = "";
    const query = search.value.trim().toLowerCase();
    const grouped = new Map();
    const source = options || getNodeTypes().filter((candidate) => candidate.type !== "output").map((def) => ({ def }));
    for (const option of source) {
      const def = option.def;
      if (query && !`${def.label} ${def.category} ${def.type}`.toLowerCase().includes(query)) continue;
      const list = grouped.get(def.category) || [];
      list.push(option);
      grouped.set(def.category, list);
    }
    for (const [category, choices] of grouped) {
      const section = document.createElement("section");
      section.className = "node-palette-category";
      const title = document.createElement("div");
      title.className = "node-palette-title";
      title.textContent = category;
      const grid = document.createElement("div");
      grid.className = "node-palette-grid";
      for (const choice of choices) {
        const def = choice.def;
        const nodeButton = button(def.label, () => {
          if (onChoose) onChoose(choice);
          else this.addSelectedNodeType(def.type, position);
          this.closeModal();
        });
        nodeButton.classList.add("node-palette-button", `category-${categorySlug(def.category)}`);
        grid.appendChild(nodeButton);
      }
      section.append(title, grid);
      groups.appendChild(section);
    }
    if (!groups.children.length) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.textContent = emptyText;
      groups.appendChild(empty);
    }
  };

  search.addEventListener("input", render);
  this.showModal(title, body);
  render();
  window.setTimeout(() => search.focus(), 0);
},

openMobileMenu() {
  const body = document.createElement("div");
  body.className = "mobile-control-menu";

  const actions = document.createElement("div");
  actions.className = "mobile-menu-actions";
  actions.append(
    button("Save Preset", () => {
      this.closeModal();
      this.savePreset();
    }),
    button("Presets", () => {
      this.closeModal();
      this.openPresets();
    }),
    button(this.store.getState().presets.cycle.enabled ? "Stop Cycling" : "Start Cycling", () => {
      this.closeModal();
      this.toggleCycle();
    }),
    button("Export", () => {
      this.closeModal();
      this.openExport();
    }),
    button("Settings", () => {
      this.closeModal();
      this.openSettings();
    }),
    button("Help", () => {
      this.closeModal();
      this.openHelp();
    })
  );
  body.appendChild(actions);

  const controls = document.createElement("div");
  controls.className = "mobile-menu-sliders";
  controls.append(
    this.renderMobileMenuRange("Depth", this.randomGraphSize(), 6, 15, 1, (value) => {
      this.syncRandomControls(value, this.elements.randomBranchRange?.value);
    }, () => {
      this.store.transact("Change Random Depth", (draft) => {
        const size = this.randomGraphSize();
        draft.settings.randomGraphSize = size;
        draft.settings.randomBranchCount = this.randomBranchCount(undefined, size);
      }, { history: false });
    }),
    this.renderMobileMenuRange("Breadth", this.randomBranchCount(), 2, 6, 1, (value) => {
      this.syncRandomControls(this.elements.randomSizeRange?.value, value);
    }, () => {
      this.store.transact("Change Random Breadth", (draft) => {
        draft.settings.randomBranchCount = this.randomBranchCount();
      }, { history: false });
    }),
    this.renderMobileMenuRange("Edges", this.randomConnectedness(), 1, 5, 1, (value) => {
      this.syncRandomConnectedness(value);
    }, () => {
      this.store.transact("Change Random Edges", (draft) => {
        draft.settings.randomConnectedness = this.randomConnectedness();
      }, { history: false });
    }),
    this.renderMobileMenuRange("Randomness", this.randomEdgeRandomness(), 0, 3, 1, (value) => {
      this.setRandomEdgeRandomness(value);
    }),
    this.renderMobileMenuRange("Mutation", this.randomMutationAmount(), 0, 1, 0.05, (value) => {
      this.setRandomMutation(value);
    }, null, (value) => `${Math.round(this.randomMutationAmount(value) * 100)}%`),
    this.renderMobileMenuRange("Speed", this.globalSpeedValue(), 0, 3, 0.1, (value) => {
      this.setGlobalSpeed(value);
    }, null, (value) => `${this.globalSpeedValue(value).toFixed(1)}x`)
  );
  body.appendChild(controls);

  this.showModal("Controls", body);
},

renderMobileMenuRange(label, value, min, max, step, onInput, onChange = null, formatValue = (next) => String(next)) {
  const wrapper = document.createElement("label");
  wrapper.className = "mobile-menu-range";
  const title = document.createElement("span");
  title.className = "field-label";
  const name = document.createElement("span");
  name.textContent = label;
  const output = document.createElement("span");
  output.textContent = formatValue(value);
  title.append(name, output);
  const input = document.createElement("input");
  input.type = "range";
  input.min = min;
  input.max = max;
  input.step = step;
  input.value = value;
  input.addEventListener("input", () => {
    onInput(input.value);
    output.textContent = formatValue(input.value);
  });
  input.addEventListener("change", () => {
    if (onChange) onChange(input.value);
    output.textContent = formatValue(input.value);
  });
  wrapper.append(title, input);
  return wrapper;
},

openSettings() {
  const body = document.createElement("div");
  const list = document.createElement("div");
  list.className = "settings-list";
  body.appendChild(list);
  const renderRows = () => {
    list.innerHTML = "";
    for (const command of Object.keys(DEFAULT_HOTKEYS)) {
      const row = document.createElement("div");
      row.className = "settings-row";
      const label = document.createElement("div");
      label.textContent = COMMAND_LABELS[command];
      const combo = document.createElement("div");
      combo.className = "kbd";
      combo.textContent = this.hotkeys.bindings[command] || "Unbound";
      const set = button("Change", () => {
        this.hotkeys.capturing = command;
        combo.textContent = "Press keys";
      });
      row.append(label, combo, set);
      list.appendChild(row);
    }
  };
  renderRows();
  const actions = document.createElement("div");
  actions.className = "modal-actions";
  actions.append(button("Reset Hotkeys", () => {
    this.hotkeys.reset();
    this.store.transact("Reset Hotkeys", (draft) => {
      draft.settings.hotkeys = {};
    });
    renderRows();
  }));
  body.prepend(actions);
  this.showModal("Settings", body);
},

openHelp() {
  const body = document.createElement("div");
  body.className = "help-content";
  body.innerHTML = `
    <section><h3>Graph</h3><p>Middle-click empty graph space to create nodes, middle-click an edge to insert a compatible operator, drag nodes by their headers, drag output ports to compatible input ports, and double-click an input port to disconnect it.</p></section>
    <section><h3>Preview</h3><p>Left-drag pans the x/y plane. Mouse wheel zooms around the cursor. Right-click resets the preview.</p></section>
    <section><h3>Presets</h3><p>Save graph states into browser storage, load them from the preset browser, or cycle them sequentially or with shuffle-bag playback.</p></section>
    <section><h3>Transitions</h3><p>Preset changes use video-style transitions: crossfade, fade through black, wipe, or dissolve.</p></section>
    <section><h3>Audio</h3><p>Select an Audio Input node to enable the microphone and choose the input device. The node outputs full level by default, or bass, mids, treble, focus, and beat bands.</p></section>
    <section><h3>Export</h3><p>PNG exports the current preview. WebM records the live canvas, active preset cycling, transitions, and microphone audio when enabled.</p></section>
    <section><h3>Random</h3><p>Depth and Breadth shape generated graphs. Edges fills compatible inputs, Randomness rewires existing edges, and Mutation controls how far parameter randomization moves from current values.</p></section>
    <section><h3>Hotkeys</h3><p>Open Settings to rebind commands. Defaults include Ctrl+Z, Ctrl+Shift+Z, Space, Delete, R, Shift+R, F, Shift+F, Ctrl+S, and Home.</p></section>
  `;
  this.showModal("Help", body);
},

showModal(title, body) {
  const root = this.elements.modalRoot;
  root.hidden = false;
  root.innerHTML = "";
  const card = document.createElement("div");
  card.className = "modal-card";
  const head = document.createElement("div");
  head.className = "modal-head";
  const titleEl = document.createElement("div");
  titleEl.textContent = title;
  const close = button("Close", () => this.closeModal());
  head.append(titleEl, close);
  const bodyWrap = document.createElement("div");
  bodyWrap.className = "modal-body";
  bodyWrap.appendChild(body);
  card.append(head, bodyWrap);
  root.appendChild(card);
  root.addEventListener("pointerdown", this.modalBackdropHandler);
},

closeModal() {
  this.elements.modalRoot.hidden = true;
  this.elements.modalRoot.innerHTML = "";
},

deferSwitchHistory(label, snapshot = this.store.getState()) {
  this.pendingSwitchHistory = {
    label,
    snapshot: structuredClone(snapshot),
    renderedFrames: 0,
    commitScheduled: false
  };
},

clearPendingSwitchHistory() {
  this.pendingSwitchHistory = null;
},

isSwitchDrawPending() {
  return Boolean(this.pendingSwitchHistory);
},

afterRender(_now, rendered = false) {
  if (!rendered || !this.pendingSwitchHistory) return;
  this.pendingSwitchHistory.renderedFrames += 1;
  if (this.pendingSwitchHistory.renderedFrames < 1 || this.pendingSwitchHistory.commitScheduled) return;
  const pending = this.pendingSwitchHistory;
  pending.commitScheduled = true;
  this.commitSwitchHistoryAfterPresentation(pending);
},

async commitSwitchHistoryAfterPresentation(pending) {
  await waitForSubmittedFrame(this.renderer);
  await nextAnimationFrame();
  await nextAnimationFrame();
  if (this.pendingSwitchHistory !== pending) return;
  const thumbnail = await this.captureRenderedThumbnail();
  if (this.pendingSwitchHistory !== pending) return;
  this.store.commitHistorySnapshot(pending.label, pending.snapshot, thumbnail);
  this.pendingSwitchHistory = null;
},

captureThumbnail() {
  try {
    return this.elements.previewCanvas.toDataURL("image/jpeg", 0.72);
  } catch {
    return "";
  }
},

async captureRenderedThumbnail() {
  try {
    return await this.renderer.captureOutputThumbnail();
  } catch (error) {
    this.store.addDiagnostic(`GPU thumbnail capture failed: ${error.message}`, "warn");
    return this.captureThumbnail();
  }
}
};
