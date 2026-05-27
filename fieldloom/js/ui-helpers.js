import { HEADER_HEIGHT, NODE_WIDTH, estimatedNodeHeight, graphBounds, portPoint } from "./graph-metrics.js";
import { findNode, findPort, getNodeDefinition } from "./nodes.js";

const PANE_MIN_WIDTHS = Object.freeze({
  preview: 300,
  graph: 320,
  inspector: 260
});

export { PANE_MIN_WIDTHS };

export function collectElements() {
  const ids = [
    "workspace", "resizePreviewGraph", "resizeGraphInspector",
    "undoBtn", "redoBtn", "playBtn", "randomGraphBtn", "randomSizeRange", "randomSizeValue",
    "randomBranchRange", "randomBranchValue", "randomConnectednessRange", "randomConnectednessValue",
    "randomEdgeRandomnessRange", "randomEdgeRandomnessValue",
    "randomMutationRange", "randomMutationValue",
    "globalSpeedRange", "globalSpeedValue", "randomParamsBtn",
    "mobileMenuBtn", "mobileEditToggle",
    "previewFullscreenBtn", "savePresetBtn", "presetsBtn", "cycleBtn", "exportBtn", "settingsBtn",
    "helpBtn", "previewCanvas", "previewStats",
    "graphStatus", "mobileAddNodeBtn", "mobileDeleteNodeBtn", "graphViewport", "graphSurface", "wireLayer", "nodeLayer", "selectionMeta",
    "inspector", "historyStrip", "historyMeta", "modalRoot"
  ];
  const elements = Object.fromEntries(ids.map((id) => [id, document.getElementById(id)]));
  elements.previewPanel = document.querySelector(".preview-panel");
  elements.graphPanel = document.querySelector(".graph-panel");
  elements.inspectorPanel = document.querySelector(".inspector-panel");
  return elements;
}

export function fitPaneColumns(columns, available) {
  const keys = ["preview", "graph", "inspector"];
  const minimumTotal = keys.reduce((sum, key) => sum + PANE_MIN_WIDTHS[key], 0);
  const target = Math.max(1, Number(available) || minimumTotal);
  if (target < minimumTotal) {
    const scale = target / minimumTotal;
    return Object.fromEntries(keys.map((key) => [key, PANE_MIN_WIDTHS[key] * scale]));
  }
  const desired = Object.fromEntries(keys.map((key) => [key, Math.max(0, Number(columns[key]) || PANE_MIN_WIDTHS[key])]));
  const desiredTotal = keys.reduce((sum, key) => sum + desired[key], 0) || minimumTotal;
  const widths = Object.fromEntries(keys.map((key) => [key, desired[key] * target / desiredTotal]));
  const locked = new Set();

  for (let pass = 0; pass < keys.length; pass += 1) {
    let changed = false;
    for (const key of keys) {
      if (!locked.has(key) && widths[key] < PANE_MIN_WIDTHS[key]) {
        widths[key] = PANE_MIN_WIDTHS[key];
        locked.add(key);
        changed = true;
      }
    }
    if (!changed) break;

    const lockedTotal = [...locked].reduce((sum, key) => sum + widths[key], 0);
    const remainingTarget = Math.max(0, target - lockedTotal);
    const unlocked = keys.filter((key) => !locked.has(key));
    const unlockedDesired = unlocked.reduce((sum, key) => sum + desired[key], 0) || 1;
    for (const key of unlocked) {
      widths[key] = desired[key] * remainingTarget / unlockedDesired;
    }
  }

  const sum = keys.reduce((total, key) => total + widths[key], 0);
  widths.inspector += target - sum;
  return widths;
}

export function responsiveGraphZoom(width) {
  const graphWidth = Math.max(0, Number(width) || 0);
  if (graphWidth < 380) return 0.65;
  if (graphWidth < 480) return 0.75;
  if (graphWidth < 620) return 0.85;
  return 1;
}

export function captureGraphHistoryThumbnail(graph) {
  try {
    const width = 320;
    const height = 180;
    const padding = 18;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx || !graph?.nodes?.length) return "";

    ctx.fillStyle = "#070b12";
    ctx.fillRect(0, 0, width, height);

    const bounds = graphBounds(graph.nodes, getNodeDefinition);
    if (!Number.isFinite(bounds.minX) || !Number.isFinite(bounds.minY)) return "";

    const graphWidth = Math.max(1, bounds.maxX - bounds.minX);
    const graphHeight = Math.max(1, bounds.maxY - bounds.minY);
    const scale = Math.min((width - padding * 2) / graphWidth, (height - padding * 2) / graphHeight);
    const offsetX = (width - graphWidth * scale) / 2 - bounds.minX * scale;
    const offsetY = (height - graphHeight * scale) / 2 - bounds.minY * scale;
    const mapPoint = (point) => ({
      x: offsetX + point.x * scale,
      y: offsetY + point.y * scale
    });
    const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));

    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = Math.max(1, 2 * scale);
    ctx.strokeStyle = "rgba(124, 147, 186, 0.55)";
    for (const edge of graph.edges || []) {
      const fromNode = nodesById.get(edge.from.nodeId);
      const toNode = nodesById.get(edge.to.nodeId);
      if (!fromNode || !toNode) continue;
      const from = mapPoint(portPoint(fromNode, edge.from.portId, "output", getNodeDefinition));
      const to = mapPoint(portPoint(toNode, edge.to.portId, "input", getNodeDefinition));
      const delta = Math.max(18, Math.abs(to.x - from.x) * 0.45);
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.bezierCurveTo(from.x + delta, from.y, to.x - delta, to.y, to.x, to.y);
      ctx.stroke();
    }

    for (const node of graph.nodes) {
      const def = getNodeDefinition(node.type);
      const x = offsetX + node.position.x * scale;
      const y = offsetY + node.position.y * scale;
      const nodeWidth = Math.max(10, NODE_WIDTH * scale);
      const nodeHeight = Math.max(8, estimatedNodeHeight(node, getNodeDefinition) * scale);
      const categoryColor = graphThumbnailCategoryColor(def?.category);

      ctx.fillStyle = "rgba(18, 25, 36, 0.96)";
      ctx.strokeStyle = categoryColor;
      ctx.lineWidth = Math.max(1, 2 * scale);
      ctx.beginPath();
      ctx.rect(x, y, nodeWidth, nodeHeight);
      ctx.fill();
      ctx.stroke();

      const headerHeight = Math.min(nodeHeight, Math.max(4, HEADER_HEIGHT * scale));
      ctx.fillStyle = categoryColor;
      ctx.globalAlpha = 0.22;
      ctx.fillRect(x, y, nodeWidth, headerHeight);
      ctx.globalAlpha = 1;

      if (nodeWidth > 46 && nodeHeight > 18) {
        ctx.fillStyle = "#d8e3f8";
        ctx.font = "10px system-ui, sans-serif";
        ctx.textBaseline = "top";
        ctx.fillText(def?.label || node.type, x + 5, y + 4, Math.max(8, nodeWidth - 10));
      }
    }

    return canvas.toDataURL("image/jpeg", 0.72);
  } catch {
    return "";
  }
}

function graphThumbnailCategoryColor(category = "unknown") {
  switch (category) {
    case "Input":
      return "#7dd3fc";
    case "Math":
      return "#facc15";
    case "Field":
      return "#a78bfa";
    case "Domain":
      return "#34d399";
    case "Coloring":
      return "#fb7185";
    case "Output":
      return "#f97316";
    default:
      return "#94a3b8";
  }
}

export function graphPointFromClient(surface, clientX, clientY, zoom = 1) {
  const rect = surface.getBoundingClientRect();
  return {
    x: (clientX - rect.left) / zoom,
    y: (clientY - rect.top) / zoom
  };
}

export function button(label, handler) {
  const el = document.createElement("button");
  el.type = "button";
  el.textContent = label;
  el.addEventListener("click", handler);
  return el;
}

export function on(element, type, handler, options = undefined) {
  if (element) element.addEventListener(type, handler, options);
}

export function nextAnimationFrame() {
  return new Promise((resolve) => requestAnimationFrame(resolve));
}

export function waitForSubmittedFrame(renderer) {
  const done = renderer?.device?.queue?.onSubmittedWorkDone?.();
  if (!done) return Promise.resolve();
  return Promise.race([
    done.catch(() => {}),
    new Promise((resolve) => window.setTimeout(resolve, 250))
  ]);
}

export function setText(element, value) {
  if (element) element.textContent = value;
}

export function setAttr(element, name, value) {
  if (element) element.setAttribute(name, value);
}

export function exportNumberRow(label, attr, value, min, max, step) {
  return `
    <label class="export-field">
      <span>${escapeHtml(label)}</span>
      <input type="number" min="${min}" max="${max}" step="${step}" ${attr} value="${escapeHtml(String(value))}">
    </label>
  `;
}

export function shuffle(values) {
  const copy = [...values];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function categorySlug(value = "unknown") {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

export function typeSlug(value = "unknown") {
  return String(value || "unknown").toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

export function portTypeForEndpoint(graph, endpoint) {
  const node = findNode(graph, endpoint.nodeId);
  const port = node ? findPort(node, endpoint.direction, endpoint.portId) : null;
  return port ? "scalar" : "";
}
