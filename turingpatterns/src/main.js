import { TuringEngine } from "./gpu-engine.js";
import { debounce, downloadCanvasPng } from "./utils.js";
import {
  MAX_SCALES,
  PRESETS,
  cloneConfig,
  configFromUrl,
  newScaleFromLast,
  randomizeConfig,
  sanitizeConfig,
  sanitizeScale,
  writeConfigToUrl,
} from "./presets.js";

const elements = {
  canvas: document.querySelector("#patternCanvas"),
  unsupportedNotice: document.querySelector("#unsupportedNotice"),
  statusLine: document.querySelector("#statusLine"),
  backendMetric: document.querySelector("#backendMetric"),
  stepMetric: document.querySelector("#stepMetric"),
  fpsMetric: document.querySelector("#fpsMetric"),
  toggleRun: document.querySelector("#toggleRun"),
  resetBtn: document.querySelector("#resetBtn"),
  randomizeBtn: document.querySelector("#randomizeBtn"),
  exportBtn: document.querySelector("#exportBtn"),
  saveUrlBtn: document.querySelector("#saveUrlBtn"),
  addScaleBtn: document.querySelector("#addScaleBtn"),
  modeSelect: document.querySelector("#modeSelect"),
  presetSelect: document.querySelector("#presetSelect"),
  resolutionSelect: document.querySelector("#resolutionSelect"),
  stepsInput: document.querySelector("#stepsInput"),
  seedInput: document.querySelector("#seedInput"),
  noiseStrengthInput: document.querySelector("#noiseStrengthInput"),
  noiseScaleInput: document.querySelector("#noiseScaleInput"),
  randomnessInput: document.querySelector("#randomnessInput"),
  randomnessValue: document.querySelector("#randomnessValue"),
  colorToggle: document.querySelector("#colorToggle"),
  scaleRows: document.querySelector("#scaleRows"),
  scaleRowTemplate: document.querySelector("#scaleRowTemplate"),
};

const state = {
  config: sanitizeConfig(configFromUrl() || PRESETS[0]),
  engine: null,
  running: true,
  applying: false,
  lastFrameTime: performance.now(),
  lastSimTime: 0,
  frameMs: 0,
  view: { zoom: 1, panX: 0, panY: 0 },
  drag: null,
};

function setStatus(text) {
  elements.statusLine.textContent = text;
}

function setControlsDisabled(disabled) {
  document.querySelectorAll("button, input, select").forEach((element) => {
    element.disabled = disabled;
  });
}

function populatePresets() {
  elements.presetSelect.innerHTML = "";
  PRESETS.forEach((preset, index) => {
    const option = document.createElement("option");
    option.value = String(index);
    option.textContent = preset.name;
    elements.presetSelect.append(option);
  });
}

function syncGlobalControls() {
  elements.modeSelect.value = state.config.mode;
  elements.resolutionSelect.value = String(state.config.resolution);
  elements.stepsInput.value = String(state.config.stepsPerFrame);
  elements.seedInput.value = String(state.config.seed);
  elements.noiseStrengthInput.value = String(state.config.noiseStrength);
  elements.noiseScaleInput.value = String(state.config.noiseScale);
  elements.randomnessInput.value = String(state.config.randomness);
  elements.randomnessValue.textContent = `${Math.round(state.config.randomness)}%`;
  elements.colorToggle.checked = state.config.colorEnabled;
}

function renderScaleRows() {
  elements.scaleRows.innerHTML = "";
  state.config.scales.forEach((scale, index) => {
    const row = elements.scaleRowTemplate.content.firstElementChild.cloneNode(true);
    row.dataset.index = String(index);
    row.querySelectorAll("[data-field]").forEach((input) => {
      const field = input.dataset.field;
      input.value = scale[field];
      input.addEventListener("change", () => {
        updateScale(index, field, input.value);
      });
      input.addEventListener("input", () => {
        if (input.type === "color") {
          updateScale(index, field, input.value);
        }
      });
    });
    row.querySelector("[data-action='remove-scale']").addEventListener("click", () => removeScale(index));
    elements.scaleRows.append(row);
  });
  elements.addScaleBtn.disabled = state.config.scales.length >= MAX_SCALES || state.applying;
}

const applyConfigDebounced = debounce((resetField = false) => {
  void applyConfig({ resetField });
}, 320);

function updateScale(index, field, rawValue) {
  const next = [...state.config.scales];
  const current = { ...next[index] };
  current[field] = field === "kernel" || field === "color" ? rawValue : Number(rawValue);
  next[index] = sanitizeScale(current);
  state.config = sanitizeConfig({ ...state.config, scales: next });
  renderScaleRows();
  applyConfigDebounced(false);
}

function removeScale(index) {
  if (state.config.scales.length <= 1) {
    return;
  }
  const next = state.config.scales.filter((_, itemIndex) => itemIndex !== index);
  state.config = sanitizeConfig({ ...state.config, scales: next });
  renderScaleRows();
  void applyConfig({ resetField: false });
}

function addScale() {
  if (state.config.scales.length >= MAX_SCALES) {
    return;
  }
  state.config = sanitizeConfig({
    ...state.config,
    scales: [...state.config.scales, newScaleFromLast(state.config.scales)],
  });
  renderScaleRows();
  void applyConfig({ resetField: false });
}

async function applyConfig({ resetField = false } = {}) {
  if (!state.engine || state.applying) {
    return;
  }
  state.applying = true;
  setControlsDisabled(true);
  setStatus("Compiling kernels...");
  await new Promise((resolve) => requestAnimationFrame(resolve));
  try {
    await state.engine.configure(state.config, { resetField });
    syncGlobalControls();
    renderScaleRows();
    setStatus(`Ready: ${state.config.resolution} x ${state.config.resolution}, ${state.config.scales.length} scales.`);
  } catch (error) {
    state.running = false;
    elements.toggleRun.textContent = "Run";
    setStatus(error instanceof Error ? error.message : "WebGPU configuration failed.");
    console.error(error);
  } finally {
    state.applying = false;
    setControlsDisabled(false);
    elements.addScaleBtn.disabled = state.config.scales.length >= MAX_SCALES;
  }
}

function bindControls() {
  elements.toggleRun.addEventListener("click", () => {
    state.running = !state.running;
    elements.toggleRun.textContent = state.running ? "Pause" : "Run";
  });

  elements.resetBtn.addEventListener("click", () => {
    void applyConfig({ resetField: true });
  });

  elements.randomizeBtn.addEventListener("click", () => {
    state.config = randomizeConfig(state.config, Math.floor(Math.random() * 4294967295));
    syncGlobalControls();
    renderScaleRows();
    void applyConfig({ resetField: true });
  });

  elements.exportBtn.addEventListener("click", async () => {
    try {
      await downloadCanvasPng(elements.canvas, `turing-${state.config.seed}-${state.engine.stepCount}.png`);
      setStatus("PNG exported.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "PNG export failed.");
    }
  });

  elements.saveUrlBtn.addEventListener("click", async () => {
    const url = writeConfigToUrl(state.config);
    try {
      await navigator.clipboard.writeText(url);
      setStatus("URL saved and copied.");
    } catch {
      setStatus("URL saved.");
    }
  });

  elements.presetSelect.addEventListener("change", () => {
    const preset = PRESETS[Number(elements.presetSelect.value)] || PRESETS[0];
    state.config = sanitizeConfig(cloneConfig(preset));
    syncGlobalControls();
    renderScaleRows();
    void applyConfig({ resetField: true });
  });

  elements.modeSelect.addEventListener("change", () => {
    state.config = sanitizeConfig({ ...state.config, mode: elements.modeSelect.value });
    syncGlobalControls();
    void applyConfig({ resetField: true });
  });

  elements.resolutionSelect.addEventListener("change", () => {
    state.config = sanitizeConfig({ ...state.config, resolution: Number(elements.resolutionSelect.value) });
    void applyConfig({ resetField: true });
  });

  elements.stepsInput.addEventListener("change", () => {
    state.config = sanitizeConfig({ ...state.config, stepsPerFrame: Number(elements.stepsInput.value) });
    syncGlobalControls();
    void applyConfig({ resetField: false });
  });

  elements.seedInput.addEventListener("change", () => {
    state.config = sanitizeConfig({ ...state.config, seed: Number(elements.seedInput.value) });
    syncGlobalControls();
    void applyConfig({ resetField: true });
  });

  elements.noiseStrengthInput.addEventListener("change", () => {
    state.config = sanitizeConfig({ ...state.config, noiseStrength: Number(elements.noiseStrengthInput.value) });
    syncGlobalControls();
    void applyConfig({ resetField: false });
  });

  elements.noiseScaleInput.addEventListener("change", () => {
    state.config = sanitizeConfig({ ...state.config, noiseScale: Number(elements.noiseScaleInput.value) });
    syncGlobalControls();
    void applyConfig({ resetField: false });
  });

  elements.randomnessInput.addEventListener("input", () => {
    state.config = sanitizeConfig({ ...state.config, randomness: Number(elements.randomnessInput.value) });
    syncGlobalControls();
  });

  elements.colorToggle.addEventListener("change", () => {
    state.config = sanitizeConfig({ ...state.config, colorEnabled: elements.colorToggle.checked });
    void applyConfig({ resetField: false });
  });

  elements.addScaleBtn.addEventListener("click", addScale);
  bindCanvasViewControls();
}

function canvasPoint(event) {
  const rect = elements.canvas.getBoundingClientRect();
  return {
    x: ((event.clientX - rect.left) / rect.width) * elements.canvas.width,
    y: ((event.clientY - rect.top) / rect.height) * elements.canvas.height,
  };
}

function canvasPointToGrid(point) {
  return {
    x: (point.x / elements.canvas.width) * state.config.resolution,
    y: (point.y / elements.canvas.height) * state.config.resolution,
  };
}

function applyView() {
  if (!state.engine) {
    return;
  }
  state.engine.setView(state.view);
  if (!state.running || state.applying) {
    state.engine.render();
  }
}

function resetView() {
  state.view = { zoom: 1, panX: 0, panY: 0 };
  if (state.engine?.restoreViewspace()) {
    state.engine.render();
    setStatus("Viewspace restored.");
    return;
  }
  applyView();
  setStatus("View reset.");
}

function reprojectViewspace(view) {
  if (!state.engine) {
    return;
  }
  state.engine.reprojectView(view);
  state.view = { zoom: 1, panX: 0, panY: 0 };
  state.engine.setView(state.view);
  state.engine.render();
}

function bindCanvasViewControls() {
  elements.canvas.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    resetView();
  });

  elements.canvas.addEventListener("wheel", (event) => {
    event.preventDefault();
    if (!state.engine) {
      return;
    }

    const point = canvasPointToGrid(canvasPoint(event));
    const factor = Math.exp(-event.deltaY * 0.0012);
    const nextZoom = Math.min(8, Math.max(0.25, factor));
    if (Math.abs(nextZoom - 1) < 0.0001) {
      return;
    }
    const center = (state.config.resolution - 1) * 0.5;
    reprojectViewspace({
      zoom: nextZoom,
      panX: center + (point.x - center) / nextZoom - point.x,
      panY: center + (point.y - center) / nextZoom - point.y,
    });
  }, { passive: false });

  elements.canvas.addEventListener("pointerdown", (event) => {
    if (event.button === 2) {
      event.preventDefault();
      return;
    }
    if (event.button !== 0 || !state.engine) {
      return;
    }
    event.preventDefault();
    elements.canvas.setPointerCapture(event.pointerId);
    elements.canvas.classList.add("is-panning");
    const point = canvasPointToGrid(canvasPoint(event));
    state.drag = {
      pointerId: event.pointerId,
      x: point.x,
      y: point.y,
    };
  });

  elements.canvas.addEventListener("pointermove", (event) => {
    if (!state.drag || event.pointerId !== state.drag.pointerId) {
      return;
    }
    event.preventDefault();
    const point = canvasPointToGrid(canvasPoint(event));
    reprojectViewspace({
      zoom: 1,
      panX: point.x - state.drag.x,
      panY: point.y - state.drag.y,
    });
    state.drag.x = point.x;
    state.drag.y = point.y;
  });

  function endDrag(event) {
    if (!state.drag || event.pointerId !== state.drag.pointerId) {
      return;
    }
    state.drag = null;
    elements.canvas.classList.remove("is-panning");
    if (elements.canvas.hasPointerCapture(event.pointerId)) {
      elements.canvas.releasePointerCapture(event.pointerId);
    }
  }

  elements.canvas.addEventListener("pointerup", endDrag);
  elements.canvas.addEventListener("pointercancel", endDrag);
}

function updateMetrics() {
  elements.backendMetric.textContent = "WebGPU";
  elements.stepMetric.textContent = `${state.engine?.stepCount ?? 0} steps`;
  elements.fpsMetric.textContent = `${state.frameMs.toFixed(1)} ms`;
}

function animate(now) {
  const elapsed = now - state.lastFrameTime;
  state.lastFrameTime = now;

  if (state.engine && state.running && !state.applying && now - state.lastSimTime >= 16) {
    const start = performance.now();
    state.engine.step(state.config.stepsPerFrame);
    state.engine.render();
    state.frameMs = performance.now() - start;
    state.lastSimTime = now;
  } else {
    state.frameMs = elapsed;
  }

  updateMetrics();
  requestAnimationFrame(animate);
}

function showUnsupported(message) {
  elements.unsupportedNotice.hidden = false;
  setStatus(message);
  setControlsDisabled(true);
  elements.backendMetric.textContent = "Unavailable";
}

async function boot() {
  populatePresets();
  bindControls();
  syncGlobalControls();
  renderScaleRows();

  if (!window.isSecureContext) {
    showUnsupported("WebGPU requires localhost or HTTPS.");
    return;
  }
  if (!navigator.gpu) {
    showUnsupported("This browser does not expose WebGPU.");
    return;
  }

  try {
    setControlsDisabled(true);
    state.engine = await TuringEngine.create(elements.canvas);
    state.engine.setView(state.view);
    await state.engine.configure(state.config, { resetField: true });
    setStatus(`Ready: ${state.config.resolution} x ${state.config.resolution}, ${state.config.scales.length} scales.`);
    setControlsDisabled(false);
    requestAnimationFrame(animate);
  } catch (error) {
    console.error(error);
    showUnsupported(error instanceof Error ? error.message : "WebGPU initialization failed.");
  }
}

void boot();
