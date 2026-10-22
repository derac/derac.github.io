import { HotkeyManager } from "./hotkeys.js";
import { saveLocalSettings } from "./storage.js";
import { graphEditor } from "./ui-graph.js";
import { collectElements, on, setAttr, setText } from "./ui-helpers.js";
import { inspectorControls } from "./ui-inspector.js";
import { modalControls } from "./ui-modals.js";
import { previewControls } from "./ui-preview.js";

export function createUI(context) {
  return new AppUI(context);
}

class AppUI {
  constructor({ store, renderer, storage, audio }) {
    this.store = store;
    this.renderer = renderer;
    this.storage = storage;
    this.audio = audio;
    this.mouseWorld = { x: 0, y: 0 };
    this.pendingWire = null;
    this.cycle = { nextAt: 0, busy: false, bag: [], presets: [] };
    this.pendingSwitchHistory = null;
    this.nextRandomGraphAt = 0;
    this.elements = collectElements();
    this.actions = this.createActions();
    this.hotkeys = new HotkeyManager(this.store.getState().settings.hotkeys, this.actions, (message) => this.setStatus(message));
    this.applySavedPaneLayout();
    this.graphZoom = this.initialGraphZoom();
    this.applyGraphTransform();
    this.bindToolbar();
    this.bindMobilePanels();
    this.bindPaneResizers();
    this.bindWorkspaceResize();
    this.bindPreview();
    this.bindGraphPan();
    this.store.subscribe((_state, reason) => {
      this.render();
      this.persistLocalSettings();
      this.storage.autosave(this.store.getState());
      if (reason === "Load Autosave") {
        requestAnimationFrame(() => this.fitGraphToViewportWidth());
      }
    });
    this.store.subscribeHistory((history) => this.renderHistory(history));
    this.store.setThumbnailProvider(() => this.captureThumbnail());
    this.render();
    this.renderHistory(this.store.getHistory());
    requestAnimationFrame(() => this.fitGraphToViewportWidth());
  }

  createActions() {
    return {
      undo: () => this.undo(),
      redo: () => this.redo(),
      playPause: () => this.togglePlay(),
      addNode: () => this.addSelectedNodeType(),
      deleteSelection: () => this.deleteSelection(),
      duplicateSelection: () => this.duplicateSelection(),
      randomGraph: () => this.randomGraph(),
      randomizeParameters: () => this.randomizeAllNodes(),
      savePreset: () => this.savePreset(),
      exportPng: () => this.openExport("image"),
      exportWebm: () => this.openExport("video"),
      toggleFullscreenPreview: () => this.togglePreviewFullscreen(),
      fitGraph: () => this.fitGraph(),
      resetPreview: () => this.resetPreview(),
      help: () => this.openHelp(),
      hotkeyChanged: () => {
        this.store.transact("Change Hotkey", (draft) => {
          draft.settings.hotkeys = { ...this.hotkeys.settings };
        });
        this.persistLocalSettings();
        this.openSettings();
      }
    };
  }

  bindToolbar() {
    on(this.elements.undoBtn, "click", () => this.undo());
    on(this.elements.redoBtn, "click", () => this.redo());
    on(this.elements.playBtn, "click", () => this.togglePlay());
    on(this.elements.randomGraphBtn, "click", () => this.randomGraph());
    on(this.elements.randomParamsBtn, "click", () => this.randomizeAllNodes());
    const initialRandomSize = this.randomGraphSize(this.store.getState().settings.randomGraphSize);
    const initialRandomBranches = this.randomBranchCount(this.store.getState().settings.randomBranchCount, initialRandomSize);
    this.syncRandomControls(initialRandomSize, initialRandomBranches);
    this.syncRandomEdgeRandomness(this.store.getState().settings.randomEdgeRandomness);
    this.syncRandomMutation(this.store.getState().settings.randomMutationAmount);
    this.syncGlobalSpeed(this.store.getState().time.scale);
    on(this.elements.randomSizeRange, "input", () => {
      this.syncRandomControls(this.elements.randomSizeRange.value, this.elements.randomBranchRange?.value);
    });
    on(this.elements.randomSizeRange, "change", () => {
      this.store.transact("Change Random Depth", (draft) => {
        const size = this.randomGraphSize();
        draft.settings.randomGraphSize = size;
        draft.settings.randomBranchCount = this.randomBranchCount(undefined, size);
      }, { history: false });
    });
    on(this.elements.randomBranchRange, "input", () => {
      this.syncRandomControls(this.elements.randomSizeRange?.value, this.elements.randomBranchRange.value);
    });
    on(this.elements.randomBranchRange, "change", () => {
      this.store.transact("Change Random Breadth", (draft) => {
        draft.settings.randomBranchCount = this.randomBranchCount();
      }, { history: false });
    });
    on(this.elements.randomConnectednessRange, "input", () => {
      this.syncRandomConnectedness(this.elements.randomConnectednessRange.value);
    });
    on(this.elements.randomConnectednessRange, "change", () => {
      this.store.transact("Change Random Edges", (draft) => {
        draft.settings.randomConnectedness = this.randomConnectedness();
      }, { history: false });
    });
    on(this.elements.randomEdgeRandomnessRange, "input", (event) => {
      this.setRandomEdgeRandomness(event.currentTarget.value);
    });
    on(this.elements.randomEdgeRandomnessRange, "change", () => {
      this.setRandomEdgeRandomness(this.elements.randomEdgeRandomnessRange.value);
    });
    on(this.elements.randomMutationRange, "input", (event) => {
      this.setRandomMutation(event.currentTarget.value);
    });
    on(this.elements.randomMutationRange, "change", () => {
      this.setRandomMutation(this.elements.randomMutationRange.value);
    });
    on(this.elements.globalSpeedRange, "input", () => this.setGlobalSpeed(this.elements.globalSpeedRange.value));
    on(this.elements.previewFullscreenBtn, "click", () => this.togglePreviewFullscreen());
    on(this.elements.savePresetBtn, "click", () => this.savePreset());
    on(this.elements.presetsBtn, "click", () => this.openPresets());
    on(this.elements.cycleBtn, "click", () => this.toggleCycle());
    on(this.elements.exportBtn, "click", () => this.openExport());
    on(this.elements.settingsBtn, "click", () => this.openSettings());
    on(this.elements.helpBtn, "click", () => this.openHelp());
    on(this.elements.mobileMenuBtn, "click", () => this.openMobileMenu());
    on(this.elements.mobileAddNodeBtn, "click", () => this.openNodePalette(this.mobileGraphInsertionPoint()));
    on(this.elements.mobileDeleteNodeBtn, "click", () => this.deleteSelection());
    document.addEventListener("fullscreenchange", () => {
      this.updateFullscreenButton();
      window.setTimeout(() => this.renderer.resize(), 50);
    });
  }

  render() {
    const state = this.store.getState();
    setText(this.elements.playBtn, state.time.playing ? "⏸️" : "▶️");
    setAttr(this.elements.playBtn, "aria-label", state.time.playing ? "Pause" : "Play");
    if (this.elements.playBtn) this.elements.playBtn.title = state.time.playing ? "Pause" : "Play";
    this.renderCycleState(state.presets.cycle);
    this.syncRandomControls(state.settings.randomGraphSize, state.settings.randomBranchCount);
    this.syncRandomConnectedness(state.settings.randomConnectedness);
    this.syncRandomEdgeRandomness(state.settings.randomEdgeRandomness);
    this.syncRandomMutation(state.settings.randomMutationAmount);
    this.syncGlobalSpeed(state.time.scale);
    this.elements.previewStats.textContent = `${this.renderer.width || 0} x ${this.renderer.height || 0} | zoom ${state.viewport.zoom.toFixed(2)}`;
    this.elements.selectionMeta.textContent = state.ui.selectedNodeIds.length ? `${state.ui.selectedNodeIds.length} selected` : "None";
    if (this.elements.mobileDeleteNodeBtn) {
      const canDelete = state.ui.selectedNodeIds.some((id) => id !== state.graph.outputNodeId);
      this.elements.mobileDeleteNodeBtn.disabled = !canDelete;
    }
    this.renderGraph();
    this.renderInspector();
  }

  modalBackdropHandler = (event) => {
    if (event.target === this.elements.modalRoot) this.closeModal();
  };

  getMouseWorld() {
    return this.mouseWorld;
  }

  setStatus(message) {
    this.store.setStatus(message);
  }

  persistLocalSettings() {
    saveLocalSettings(this.store.getState().settings);
  }
}

Object.assign(AppUI.prototype, previewControls, graphEditor, inspectorControls, modalControls);
