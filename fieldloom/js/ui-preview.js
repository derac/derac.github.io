import { GRAPH_HEIGHT, GRAPH_WIDTH, graphBounds } from "./graph-metrics.js";
import { getNodeDefinition } from "./nodes.js";
import { PANE_MIN_WIDTHS, clamp, fitPaneColumns, graphPointFromClient, on, responsiveGraphZoom } from "./ui-helpers.js";

const GRAPH_ZOOM_MIN = 0.25;
const GRAPH_ZOOM_MAX = 2.5;
const PANE_RESIZER_WIDTH = 8;
const PANE_TOTAL_RESIZER_WIDTH = PANE_RESIZER_WIDTH * 2;

export const previewControls = {
bindMobilePanels() {
  this.syncMobileEditToggle();
  on(this.elements.mobileEditToggle, "click", () => this.toggleMobileEditGroup());
},

toggleMobileEditGroup() {
  const collapsed = this.elements.workspace.classList.toggle("mobile-edit-collapsed");
  this.syncMobileEditToggle();
  this.renderer.resize();
  if (!collapsed) {
    requestAnimationFrame(() => {
      this.fitGraphToViewportWidth();
      this.renderer.resize();
    });
  }
},

syncMobileEditToggle() {
  const button = this.elements.mobileEditToggle;
  if (!button) return;
  const collapsed = this.elements.workspace.classList.contains("mobile-edit-collapsed");
  button.textContent = collapsed ? "Show Graph / Parameters" : "Hide Graph / Parameters";
  button.setAttribute("aria-expanded", String(!collapsed));
},

async togglePreviewFullscreen() {
  const target = this.elements.previewPanel;
  if (!target) return;
  try {
    if (document.fullscreenElement === target) {
      await document.exitFullscreen();
    } else {
      await target.requestFullscreen();
    }
  } catch (error) {
    this.setStatus(`Fullscreen failed: ${error.message}`);
    this.store.addDiagnostic(error.message, "warn");
  }
},

updateFullscreenButton() {
  if (!this.elements.previewFullscreenBtn) return;
  const active = document.fullscreenElement === this.elements.previewPanel;
  this.elements.previewFullscreenBtn.textContent = active ? "⤢" : "⛶";
  this.elements.previewFullscreenBtn.title = active ? "Exit Fullscreen Preview" : "Fullscreen Preview";
  this.elements.previewFullscreenBtn.setAttribute("aria-label", this.elements.previewFullscreenBtn.title);
},

bindPaneResizers() {
  const handles = [this.elements.resizePreviewGraph, this.elements.resizeGraphInspector].filter(Boolean);
  for (const handle of handles) {
    handle.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      const start = this.normalizePaneColumns({
        x: event.clientX,
        preview: this.elements.previewPanel.getBoundingClientRect().width,
        graph: this.elements.graphPanel.getBoundingClientRect().width,
        inspector: this.elements.inspectorPanel.getBoundingClientRect().width
      });
      start.x = event.clientX;
      const total = this.availablePaneWidth() || start.preview + start.graph + start.inspector;
      const kind = handle.dataset.resizer;
      handle.setPointerCapture(event.pointerId);
      handle.classList.add("dragging");

      const move = (moveEvent) => {
        const dx = moveEvent.clientX - start.x;
        let preview = start.preview;
        let graph = start.graph;
        let inspector = start.inspector;
        if (kind === "preview-graph") {
          preview = clamp(start.preview + dx, PANE_MIN_WIDTHS.preview, total - PANE_MIN_WIDTHS.graph - PANE_MIN_WIDTHS.inspector);
          graph = clamp(start.graph - (preview - start.preview), PANE_MIN_WIDTHS.graph, total - preview - PANE_MIN_WIDTHS.inspector);
          inspector = total - preview - graph;
        } else {
          graph = clamp(start.graph + dx, PANE_MIN_WIDTHS.graph, total - start.preview - PANE_MIN_WIDTHS.inspector);
          inspector = clamp(total - start.preview - graph, PANE_MIN_WIDTHS.inspector, total - start.preview - PANE_MIN_WIDTHS.graph);
          preview = total - graph - inspector;
        }
        this.setPaneColumns({ preview, graph, inspector });
      };

      const up = () => {
        handle.classList.remove("dragging");
        handle.removeEventListener("pointermove", move);
        handle.removeEventListener("pointerup", up);
        const panes = this.currentPaneColumns();
        this.store.transact("Resize Panes", (draft) => {
          draft.settings.layout = { ...(draft.settings.layout || {}), panes };
        }, { history: false });
        requestAnimationFrame(() => this.fitGraphToViewportWidth());
      };

      handle.addEventListener("pointermove", move);
      handle.addEventListener("pointerup", up);
    });
  }
},

bindWorkspaceResize() {
  const workspace = this.elements.workspace;
  if (!workspace) return;
  let frame = 0;
  const resize = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      if (window.matchMedia("(max-width: 900px)").matches) return;
      this.setPaneColumns(this.currentPaneColumns());
      this.fitGraphToViewportWidth();
    });
  };
  if ("ResizeObserver" in window) {
    const observer = new ResizeObserver(resize);
    observer.observe(workspace);
  } else {
    window.addEventListener("resize", resize);
  }
},

applySavedPaneLayout() {
  const panes = this.store.getState().settings.layout?.panes;
  if (panes?.preview && panes?.graph && panes?.inspector) {
    this.setPaneColumns(panes);
  }
},

currentPaneColumns() {
  return this.normalizePaneColumns({
    preview: Math.round(this.elements.previewPanel.getBoundingClientRect().width),
    graph: Math.round(this.elements.graphPanel.getBoundingClientRect().width),
    inspector: Math.round(this.elements.inspectorPanel.getBoundingClientRect().width)
  });
},

setPaneColumns({ preview, graph, inspector }) {
  const panes = this.normalizePaneColumns({ preview, graph, inspector });
  this.elements.workspace.style.setProperty("--preview-col", `${panes.preview.toFixed(3)}px`);
  this.elements.workspace.style.setProperty("--graph-col", `${panes.graph.toFixed(3)}px`);
  this.elements.workspace.style.setProperty("--inspector-col", `${panes.inspector.toFixed(3)}px`);
  this.renderer.resize();
},

availablePaneWidth() {
  const workspace = this.elements.workspace;
  if (!workspace) return 0;
  const styles = getComputedStyle(workspace);
  const padding = parseFloat(styles.paddingLeft) + parseFloat(styles.paddingRight);
  return Math.max(1, workspace.clientWidth - padding - PANE_TOTAL_RESIZER_WIDTH);
},

normalizePaneColumns({ preview, graph, inspector }) {
  const available = this.availablePaneWidth();
  return fitPaneColumns({ preview, graph, inspector }, available);
},

bindPreview() {
  const canvas = this.elements.previewCanvas;
  if (!canvas) return;
  let dragging = null;
  let pinch = null;
  const activePointers = new Map();
  const previewDistance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const previewMidpoint = (a, b) => ({
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2
  });
  const previewPair = () => [...activePointers.values()].slice(0, 2);
  const startPinch = () => {
    const [a, b] = previewPair();
    if (!a || !b) return;
    const midpoint = previewMidpoint(a, b);
    pinch = {
      distance: Math.max(1, previewDistance(a, b)),
      midpoint,
      viewport: structuredClone(this.store.getState().viewport)
    };
    dragging = null;
  };
  canvas.addEventListener("pointermove", (event) => {
    if (activePointers.has(event.pointerId)) {
      activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    }
    this.mouseWorld = this.screenToWorld(event.clientX, event.clientY);
    if (pinch && activePointers.size >= 2) {
      event.preventDefault();
      const [a, b] = previewPair();
      const midpoint = previewMidpoint(a, b);
      const scale = previewDistance(a, b) / pinch.distance;
      const nextZoom = clamp(pinch.viewport.zoom * scale, 0.08, 80);
      const before = this.screenToWorld(pinch.midpoint.x, pinch.midpoint.y, pinch.viewport);
      const after = this.screenToWorld(midpoint.x, midpoint.y, { ...pinch.viewport, zoom: nextZoom });
      this.store.transact("Pinch Zoom Preview", (draft) => {
        draft.viewport.zoom = nextZoom;
        draft.viewport.offsetX = pinch.viewport.offsetX + before.x - after.x;
        draft.viewport.offsetY = pinch.viewport.offsetY + before.y - after.y;
      }, { history: false });
      return;
    }
    if (!dragging) return;
    const state = this.store.getState();
    const dx = event.clientX - dragging.x;
    const dy = event.clientY - dragging.y;
    const units = 2 / Math.max(1, canvas.clientHeight) / Math.max(0.0001, dragging.viewport.zoom);
    const nextViewport = {
      ...state.viewport,
      offsetX: dragging.viewport.offsetX - dx * units,
      offsetY: dragging.viewport.offsetY + dy * units
    };
    this.store.transact("Pan Preview", (draft) => {
      draft.viewport = nextViewport;
    }, { history: false });
  });
  canvas.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    canvas.setPointerCapture(event.pointerId);
    activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (activePointers.size >= 2) {
      startPinch();
    } else {
      dragging = {
        x: event.clientX,
        y: event.clientY,
        viewport: structuredClone(this.store.getState().viewport),
        moved: false
      };
    }
  });
  const stopPointer = (event) => {
    activePointers.delete(event.pointerId);
    if (pinch && activePointers.size < 2) {
      this.store.commitHistory("Pinch Zoom Preview");
      pinch = null;
      const [remaining] = activePointers.values();
      dragging = remaining
        ? {
            x: remaining.x,
            y: remaining.y,
            viewport: structuredClone(this.store.getState().viewport),
            moved: false
          }
        : null;
      return;
    }
    if (dragging) this.store.commitHistory("Pan Preview");
    dragging = null;
  };
  canvas.addEventListener("pointerup", stopPointer);
  canvas.addEventListener("pointercancel", stopPointer);
  canvas.addEventListener("wheel", (event) => {
    event.preventDefault();
    const before = this.screenToWorld(event.clientX, event.clientY);
    const state = this.store.getState();
    const nextZoom = clamp(state.viewport.zoom * Math.exp(-event.deltaY * 0.0016), 0.08, 80);
    const after = this.screenToWorld(event.clientX, event.clientY, { ...state.viewport, zoom: nextZoom });
    this.store.transact("Zoom Preview", (draft) => {
      draft.viewport.zoom = nextZoom;
      draft.viewport.offsetX += before.x - after.x;
      draft.viewport.offsetY += before.y - after.y;
    });
  }, { passive: false });
  canvas.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    this.resetPreview();
  });
},

bindGraphPan() {
  const viewport = this.elements.graphViewport;
  if (!viewport || !this.elements.graphSurface) return;
  let pan = null;
  let pinch = null;
  const activePointers = new Map();
  const pointerDistance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const pointerMidpoint = (a, b) => ({
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2
  });
  const pointerPair = () => [...activePointers.values()].slice(0, 2);
  const startPinch = () => {
    const [a, b] = pointerPair();
    if (!a || !b) return;
    pan = null;
    viewport.classList.remove("panning");
    pinch = {
      distance: Math.max(1, pointerDistance(a, b)),
      zoom: this.graphZoom
    };
  };
  const stopPan = () => {
    pan = null;
    pinch = null;
    viewport.classList.remove("panning");
  };
  viewport.addEventListener("pointerdown", (event) => {
    if (event.button === 1) {
      event.preventDefault();
      if (!event.target.closest(".node-card") && !event.target.closest(".port-dot") && !event.target.closest(".wire-path") && !event.target.closest(".wire-hit")) {
        this.openNodePalette(graphPointFromClient(this.elements.graphSurface, event.clientX, event.clientY, this.graphZoom));
      }
      return;
    }
    if (event.button !== 0) return;
    activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (activePointers.size >= 2) {
      event.preventDefault();
      viewport.setPointerCapture(event.pointerId);
      startPinch();
      return;
    }
    if (event.target.closest(".node-card") || event.target.closest(".port-dot") || event.target.closest(".wire-path") || event.target.closest(".wire-hit")) return;
    event.preventDefault();
    pan = {
      x: event.clientX,
      y: event.clientY,
      left: viewport.scrollLeft,
      top: viewport.scrollTop
    };
    viewport.setPointerCapture(event.pointerId);
    viewport.classList.add("panning");
  });
  viewport.addEventListener("pointermove", (event) => {
    if (activePointers.has(event.pointerId)) {
      activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    }
    if (pinch && activePointers.size >= 2) {
      event.preventDefault();
      const [a, b] = pointerPair();
      const midpoint = pointerMidpoint(a, b);
      const nextZoom = clamp(pinch.zoom * (pointerDistance(a, b) / pinch.distance), GRAPH_ZOOM_MIN, GRAPH_ZOOM_MAX);
      this.setGraphZoomAt(midpoint.x, midpoint.y, nextZoom);
      return;
    }
    if (!pan) return;
    viewport.scrollLeft = pan.left - (event.clientX - pan.x);
    viewport.scrollTop = pan.top - (event.clientY - pan.y);
  });
  viewport.addEventListener("wheel", (event) => {
    event.preventDefault();
    const nextZoom = clamp(this.graphZoom * Math.exp(-event.deltaY * 0.0014), GRAPH_ZOOM_MIN, GRAPH_ZOOM_MAX);
    this.setGraphZoomAt(event.clientX, event.clientY, nextZoom);
  }, { passive: false });
  viewport.addEventListener("auxclick", (event) => {
    if (event.button === 1) event.preventDefault();
  });
  const stopPointer = (event) => {
    activePointers.delete(event.pointerId);
    if (activePointers.size < 2) pinch = null;
    stopPan();
  };
  viewport.addEventListener("pointerup", stopPointer);
  viewport.addEventListener("pointercancel", stopPointer);
},

applyGraphTransform() {
  const width = GRAPH_WIDTH * this.graphZoom;
  const height = GRAPH_HEIGHT * this.graphZoom;
  if (this.elements.graphSurface) {
    this.elements.graphSurface.style.width = `${width}px`;
    this.elements.graphSurface.style.height = `${height}px`;
  }
  if (this.elements.wireLayer) {
    this.elements.wireLayer.style.width = `${GRAPH_WIDTH}px`;
    this.elements.wireLayer.style.height = `${GRAPH_HEIGHT}px`;
    this.elements.wireLayer.style.transform = `scale(${this.graphZoom})`;
  }
  if (this.elements.nodeLayer) {
    this.elements.nodeLayer.style.width = `${GRAPH_WIDTH}px`;
    this.elements.nodeLayer.style.height = `${GRAPH_HEIGHT}px`;
    this.elements.nodeLayer.style.transform = `scale(${this.graphZoom})`;
  }
},

setGraphZoomAt(clientX, clientY, nextZoom) {
  const viewport = this.elements.graphViewport;
  const rect = viewport.getBoundingClientRect();
  const localX = clientX - rect.left;
  const localY = clientY - rect.top;
  const baseX = (viewport.scrollLeft + localX) / this.graphZoom;
  const baseY = (viewport.scrollTop + localY) / this.graphZoom;
  this.graphZoom = nextZoom;
  this.applyGraphTransform();
  viewport.scrollLeft = baseX * this.graphZoom - localX;
  viewport.scrollTop = baseY * this.graphZoom - localY;
  this.store.transact("Zoom Patch Graph", (draft) => {
    draft.settings.layout = { ...(draft.settings.layout || {}), graphZoom: this.graphZoom, graphZoomDefaultVersion: 2 };
  }, { history: false });
},

initialGraphZoom() {
  const saved = Number(this.store.getState().settings.layout?.graphZoom);
  if (Number.isFinite(saved) && saved > 0) return clamp(saved, GRAPH_ZOOM_MIN, GRAPH_ZOOM_MAX);
  return responsiveGraphZoom(this.elements.graphPanel?.getBoundingClientRect().width || window.innerWidth);
},

resetPreview() {
  this.store.transact("Reset Preview", (draft) => {
    draft.viewport = { offsetX: 0, offsetY: 0, zoom: 1 };
  });
},

fitGraph() {
  this.fitGraphToViewportWidth("smooth");
},

centerGraphViewport(behavior = "auto") {
  const nodes = this.store.getState().graph.nodes;
  const viewport = this.elements.graphViewport;
  if (!nodes.length || !viewport) return;
  const bounds = graphBounds(nodes, getNodeDefinition);
  const centerX = (bounds.minX + bounds.maxX) * 0.5 * this.graphZoom;
  const centerY = (bounds.minY + bounds.maxY) * 0.5 * this.graphZoom;
  viewport.scrollTo({
    left: clamp(centerX - viewport.clientWidth * 0.5, 0, Math.max(0, viewport.scrollWidth - viewport.clientWidth)),
    top: clamp(centerY - viewport.clientHeight * 0.5, 0, Math.max(0, viewport.scrollHeight - viewport.clientHeight)),
    behavior
  });
},

fitGraphToViewportWidth(behavior = "auto") {
  const nodes = this.store.getState().graph.nodes;
  const viewport = this.elements.graphViewport;
  if (!nodes.length || !viewport) return;
  const bounds = graphBounds(nodes, getNodeDefinition);
  if (!Number.isFinite(bounds.minX) || !Number.isFinite(bounds.maxX)) return;

  const padding = Math.min(48, Math.max(20, viewport.clientWidth * 0.08));
  const availableWidth = Math.max(1, viewport.clientWidth - padding * 2);
  const boundsWidth = Math.max(1, bounds.maxX - bounds.minX);
  this.graphZoom = clamp(availableWidth / boundsWidth, GRAPH_ZOOM_MIN, GRAPH_ZOOM_MAX);
  this.applyGraphTransform();

  const scaledMinX = bounds.minX * this.graphZoom;
  const scaledMaxX = bounds.maxX * this.graphZoom;
  const scaledCenterX = (scaledMinX + scaledMaxX) * 0.5;
  const scaledCenterY = (bounds.minY + bounds.maxY) * 0.5 * this.graphZoom;
  const maxLeft = Math.max(0, GRAPH_WIDTH * this.graphZoom - viewport.clientWidth);
  const maxTop = Math.max(0, GRAPH_HEIGHT * this.graphZoom - viewport.clientHeight);
  const fitsWidth = scaledMaxX - scaledMinX <= viewport.clientWidth - padding * 2 + 1;
  const left = fitsWidth
    ? scaledCenterX - viewport.clientWidth * 0.5
    : scaledMinX - padding;

  viewport.scrollTo({
    left: clamp(left, 0, maxLeft),
    top: clamp(scaledCenterY - viewport.clientHeight * 0.5, 0, maxTop),
    behavior
  });
  this.elements.graphStatus.textContent = `${nodes.length} nodes | ${this.store.getState().graph.edges.length} wires | ${Math.round(this.graphZoom * 100)}%`;
},

screenToWorld(clientX, clientY, viewport = this.store.getState().viewport) {
  const rect = this.elements.previewCanvas.getBoundingClientRect();
  const uvX = (clientX - rect.left) / Math.max(1, rect.width);
  const uvY = (clientY - rect.top) / Math.max(1, rect.height);
  const centeredX = uvX * 2 - 1;
  const centeredY = uvY * 2 - 1;
  const aspect = rect.width / Math.max(1, rect.height);
  return {
    x: centeredX * aspect / Math.max(0.0001, viewport.zoom) + viewport.offsetX,
    y: -centeredY / Math.max(0.0001, viewport.zoom) + viewport.offsetY
  };
}
};
