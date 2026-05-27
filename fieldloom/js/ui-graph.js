import { GRAPH_HEIGHT, GRAPH_WIDTH, NODE_WIDTH, curvedPath, estimatedNodeHeight, portPoint } from "./graph-metrics.js";
import { canConnect, createNode, edge, findEdgeInsertionOptions, findNode, getEdgePortTypes, getNodeDefinition, getNodeTypes, makeId } from "./nodes.js";
import { mutateNodeParams, randomizeGraph, randomizeGraphEdges } from "./random.js";
import { captureGraphHistoryThumbnail, categorySlug, clamp, escapeHtml, graphPointFromClient, portTypeForEndpoint, setText, typeSlug } from "./ui-helpers.js";

export const graphEditor = {
renderGraph() {
  const state = this.store.getState();
  const { nodeLayer } = this.elements;
  nodeLayer.innerHTML = "";
  for (const node of state.graph.nodes) {
    nodeLayer.appendChild(this.renderNode(node));
  }
  this.renderWires();
  this.elements.graphStatus.textContent = `${state.graph.nodes.length} nodes | ${state.graph.edges.length} wires | ${Math.round(this.graphZoom * 100)}%`;
},

renderNode(node) {
  const def = getNodeDefinition(node.type);
  const state = this.store.getState();
  const selected = state.ui.selectedNodeIds.includes(node.id);
  const card = document.createElement("div");
  card.className = `node-card category-${categorySlug(def?.category)}${selected ? " selected" : ""}`;
  card.style.left = `${node.position.x}px`;
  card.style.top = `${node.position.y}px`;
  card.dataset.nodeId = node.id;

  const header = document.createElement("div");
  header.className = "node-header";
  header.innerHTML = `<span>${escapeHtml(def?.label || node.type)}</span><span class="node-category">${escapeHtml(def?.category || "")}</span>`;
  header.addEventListener("pointerdown", (event) => this.startNodeDrag(event, node.id));
  card.appendChild(header);

  const body = document.createElement("div");
  body.className = "node-body";
  const inputs = document.createElement("div");
  const outputs = document.createElement("div");
  for (const port of def?.inputs || []) inputs.appendChild(this.renderPort(node, port, "input"));
  for (const port of def?.outputs || []) outputs.appendChild(this.renderPort(node, port, "output"));
  body.append(inputs, outputs);
  card.appendChild(body);

  card.addEventListener("pointerdown", (event) => {
    if (event.button === 1) {
      event.preventDefault();
      event.stopPropagation();
      this.deleteNode(node.id);
      return;
    }
    if (event.target.closest(".port-dot") || event.target.closest(".node-header")) return;
    this.selectNode(node.id, event);
  });
  card.addEventListener("auxclick", (event) => {
    if (event.button === 1) event.preventDefault();
  });
  return card;
},

renderPort(node, port, direction) {
  const row = document.createElement("div");
  row.className = `port-row ${direction}`;
  const dot = document.createElement("span");
  dot.className = `port-dot ${direction}`;
  dot.dataset.nodeId = node.id;
  dot.dataset.portId = port.id;
  dot.dataset.direction = direction;
  dot.dataset.type = "scalar";
  dot.title = port.label;
  const label = document.createElement("span");
  label.textContent = port.label;
  if (direction === "input") {
    row.append(dot, label);
    dot.addEventListener("pointerdown", (event) => this.startWire(event, node.id, port.id, "input"));
    dot.addEventListener("dblclick", (event) => {
      event.stopPropagation();
      this.disconnectInput(node.id, port.id);
    });
  } else {
    row.append(label, dot);
    dot.addEventListener("pointerdown", (event) => this.startWire(event, node.id, port.id, "output"));
  }
  return row;
},

renderWires() {
  const state = this.store.getState();
  const svg = this.elements.wireLayer;
  svg.setAttribute("viewBox", `0 0 ${GRAPH_WIDTH} ${GRAPH_HEIGHT}`);
  svg.innerHTML = "";
  for (const current of state.graph.edges) {
    const fromNode = findNode(state.graph, current.from.nodeId);
    const toNode = findNode(state.graph, current.to.nodeId);
    if (!fromNode || !toNode) continue;
    const a = portPoint(fromNode, current.from.portId, "output", getNodeDefinition);
    const b = portPoint(toNode, current.to.portId, "input", getNodeDefinition);
    const edgeTypes = getEdgePortTypes(state.graph, current);
    const typeClass = `type-${typeSlug(edgeTypes?.fromType || "")}`;
    const hit = document.createElementNS("http://www.w3.org/2000/svg", "path");
    hit.setAttribute("class", `wire-hit ${typeClass}`);
    hit.setAttribute("d", curvedPath(a, b));
    hit.dataset.edgeId = current.id;
    hit.addEventListener("pointerdown", (event) => {
      event.stopPropagation();
      event.preventDefault();
      if (event.button === 0) {
        this.removeEdge(current.id);
        return;
      }
      if (event.button === 1) {
        this.openEdgeInsertPalette(current, graphPointFromClient(this.elements.graphSurface, event.clientX, event.clientY, this.graphZoom));
      }
    });
    hit.addEventListener("auxclick", (event) => {
      if (event.button === 1) {
        event.preventDefault();
        event.stopPropagation();
      }
    });
    svg.appendChild(hit);
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("class", `wire-path ${typeClass}`);
    path.setAttribute("d", curvedPath(a, b));
    path.dataset.edgeId = current.id;
    path.dataset.type = edgeTypes?.fromType || "";
    svg.appendChild(path);
  }
  if (this.pendingWire) {
    const startNode = findNode(state.graph, this.pendingWire.start.nodeId);
    if (startNode) {
      const start = portPoint(startNode, this.pendingWire.start.portId, this.pendingWire.start.direction, getNodeDefinition);
      const cursor = this.pendingWire.cursor || start;
      const a = this.pendingWire.start.direction === "output" ? start : cursor;
      const b = this.pendingWire.start.direction === "output" ? cursor : start;
      const temp = document.createElementNS("http://www.w3.org/2000/svg", "path");
      temp.setAttribute("class", `wire-temp type-${typeSlug(portTypeForEndpoint(state.graph, this.pendingWire.start) || "")}`);
      temp.setAttribute("d", curvedPath(a, b));
      svg.appendChild(temp);
    }
  }
},

renderHistory({ entries, index }) {
  const strip = this.elements.historyStrip;
  strip.innerHTML = "";
  [...entries].map((entry, entryIndex) => ({ entry, entryIndex })).reverse().forEach(({ entry, entryIndex }) => {
    const item = document.createElement("button");
    item.className = `history-item${entryIndex === index ? " active" : ""}`;
    item.title = entry.label;
    const img = document.createElement("img");
    img.className = "history-thumb";
    if (entry.thumbnail) img.src = entry.thumbnail;
    const label = document.createElement("div");
    label.className = "history-label";
    label.textContent = entry.label;
    item.append(img, label);
    item.addEventListener("click", () => this.store.restoreHistory(entryIndex));
    strip.appendChild(item);
  });
  this.elements.historyMeta.textContent = `${index + 1} / ${entries.length}`;
  if (index === entries.length - 1) strip.scrollLeft = 0;
  else strip.querySelector(".history-item.active")?.scrollIntoView({ block: "nearest", inline: "nearest" });
},

startNodeDrag(event, nodeId) {
  if (event.button !== 0) return;
  this.selectNode(nodeId, event);
  const state = this.store.getState();
  const selected = state.ui.selectedNodeIds.includes(nodeId) ? state.ui.selectedNodeIds : [nodeId];
  const starts = new Map(selected.map((id) => {
    const node = findNode(state.graph, id);
    return [id, { x: node.position.x, y: node.position.y }];
  }));
  const origin = { x: event.clientX, y: event.clientY };
  let moved = false;
  const move = (moveEvent) => {
    const dx = (moveEvent.clientX - origin.x) / this.graphZoom;
    const dy = (moveEvent.clientY - origin.y) / this.graphZoom;
    if (Math.abs(dx) + Math.abs(dy) > 1) moved = true;
    this.store.transact("Move Node", (draft) => {
      for (const id of selected) {
        const node = findNode(draft.graph, id);
        const start = starts.get(id);
        if (node && start) {
          node.position.x = clamp(start.x + dx, 20, GRAPH_WIDTH - NODE_WIDTH - 20);
          node.position.y = clamp(start.y + dy, 20, GRAPH_HEIGHT - estimatedNodeHeight(node, getNodeDefinition) - 20);
        }
      }
    }, { history: false });
  };
  const up = () => {
    document.removeEventListener("pointermove", move);
    document.removeEventListener("pointerup", up);
    if (moved) this.store.commitHistory("Move Node");
  };
  document.addEventListener("pointermove", move);
  document.addEventListener("pointerup", up);
},

startWire(event, nodeId, portId, direction) {
  if (event.button !== 0 || event.detail > 1) return;
  event.stopPropagation();
  event.preventDefault();
  this.pendingWire = {
    start: { nodeId, portId, direction },
    cursor: graphPointFromClient(this.elements.graphSurface, event.clientX, event.clientY, this.graphZoom)
  };
  const move = (moveEvent) => {
    this.pendingWire.cursor = graphPointFromClient(this.elements.graphSurface, moveEvent.clientX, moveEvent.clientY, this.graphZoom);
    this.renderWires();
  };
  const up = (upEvent) => {
    document.removeEventListener("pointermove", move);
    document.removeEventListener("pointerup", up);
    const selector = direction === "output" ? ".port-dot.input" : ".port-dot.output";
    const target = document.elementFromPoint(upEvent.clientX, upEvent.clientY)?.closest(selector);
    if (target) {
      if (direction === "output") {
        this.connectPorts(this.pendingWire.start, { nodeId: target.dataset.nodeId, portId: target.dataset.portId });
      } else {
        this.connectPorts({ nodeId: target.dataset.nodeId, portId: target.dataset.portId }, this.pendingWire.start);
      }
    }
    this.pendingWire = null;
    this.renderWires();
  };
  document.addEventListener("pointermove", move);
  document.addEventListener("pointerup", up);
},

connectPorts(from, to) {
  const state = this.store.getState();
  const result = canConnect(state.graph, from, to);
  if (!result.ok) {
    this.setStatus(result.reason);
    return;
  }
  this.store.transact("Connect Nodes", (draft) => {
    draft.graph.edges = draft.graph.edges.filter((current) => !(current.to.nodeId === to.nodeId && current.to.portId === to.portId));
    draft.graph.edges.push(edge(from.nodeId, from.portId, to.nodeId, to.portId));
  });
},

disconnectInput(nodeId, portId) {
  this.store.transact("Disconnect Input", (draft) => {
    draft.graph.edges = draft.graph.edges.filter((current) => !(current.to.nodeId === nodeId && current.to.portId === portId));
  });
},

removeEdge(edgeId) {
  this.store.transact("Remove Edge", (draft) => {
    draft.graph.edges = draft.graph.edges.filter((current) => current.id !== edgeId);
  });
},

openEdgeInsertPalette(current, position) {
  const options = findEdgeInsertionOptions(this.store.getState().graph, current);
  if (!options.length) {
    this.setStatus("No compatible operators can be inserted on that edge.");
    return;
  }
  this.openNodePalette(position, {
    title: "Insert Operator",
    options,
    emptyText: "No compatible operators.",
    onChoose: (choice) => this.insertNodeOnEdge(current.id, choice.def.type, choice.inputPort.id, choice.outputPort.id, position)
  });
},

insertNodeOnEdge(edgeId, type, inputPortId, outputPortId, position) {
  this.store.transact("Insert Node On Edge", (draft) => {
    const current = draft.graph.edges.find((candidate) => candidate.id === edgeId);
    if (!current) return;
    const node = createNode(type, position);
    draft.graph.nodes.push(node);
    draft.graph.edges = draft.graph.edges.filter((candidate) => candidate.id !== edgeId);
    draft.graph.edges.push(
      edge(current.from.nodeId, current.from.portId, node.id, inputPortId),
      edge(node.id, outputPortId, current.to.nodeId, current.to.portId)
    );
    draft.ui.selectedNodeIds = [node.id];
  });
},

selectNode(nodeId, event = null) {
  this.store.transact("Select Node", (draft) => {
    const selected = new Set(draft.ui.selectedNodeIds);
    if (event?.ctrlKey || event?.metaKey || event?.shiftKey) {
      if (selected.has(nodeId)) selected.delete(nodeId);
      else selected.add(nodeId);
    } else {
      selected.clear();
      selected.add(nodeId);
    }
    draft.ui.selectedNodeIds = [...selected];
  }, { history: false });
},

addSelectedNodeType(type = "fbmNoise", position = null) {
  const viewport = this.elements.graphViewport;
  const x = position?.x ?? (viewport.scrollLeft + Math.min(260, viewport.clientWidth * 0.35)) / this.graphZoom;
  const y = position?.y ?? (viewport.scrollTop + Math.min(180, viewport.clientHeight * 0.35)) / this.graphZoom;
  this.store.transact("Add Node", (draft) => {
    const node = createNode(type, { x, y });
    draft.graph.nodes.push(node);
    draft.ui.selectedNodeIds = [node.id];
  });
},

mobileGraphInsertionPoint() {
  const viewport = this.elements.graphViewport;
  return {
    x: (viewport.scrollLeft + viewport.clientWidth * 0.5) / this.graphZoom,
    y: (viewport.scrollTop + viewport.clientHeight * 0.5) / this.graphZoom
  };
},

deleteSelection() {
  const selected = this.store.getState().ui.selectedNodeIds;
  if (!selected.length) return;
  this.store.transact("Delete Selection", (draft) => {
    const removable = new Set(selected.filter((id) => id !== draft.graph.outputNodeId));
    draft.graph.nodes = draft.graph.nodes.filter((node) => !removable.has(node.id));
    draft.graph.edges = draft.graph.edges.filter((current) => !removable.has(current.from.nodeId) && !removable.has(current.to.nodeId));
    draft.ui.selectedNodeIds = [];
  });
},

deleteNode(nodeId) {
  const state = this.store.getState();
  if (nodeId === state.graph.outputNodeId) {
    this.setStatus("Output node cannot be removed.");
    return;
  }
  this.store.transact("Delete Node", (draft) => {
    draft.graph.nodes = draft.graph.nodes.filter((node) => node.id !== nodeId);
    draft.graph.edges = draft.graph.edges.filter((current) => current.from.nodeId !== nodeId && current.to.nodeId !== nodeId);
    draft.ui.selectedNodeIds = draft.ui.selectedNodeIds.filter((id) => id !== nodeId);
  });
},

duplicateSelection() {
  const state = this.store.getState();
  const selected = state.ui.selectedNodeIds.filter((id) => id !== state.graph.outputNodeId);
  if (!selected.length) return;
  this.store.transact("Duplicate Selection", (draft) => {
    const map = new Map();
    const clones = [];
    for (const id of selected) {
      const source = findNode(draft.graph, id);
      if (!source) continue;
      const clone = structuredClone(source);
      clone.id = makeId("node");
      clone.position.x += 32;
      clone.position.y += 32;
      map.set(id, clone.id);
      clones.push(clone);
    }
    draft.graph.nodes.push(...clones);
    for (const current of state.graph.edges) {
      if (map.has(current.from.nodeId) && map.has(current.to.nodeId)) {
        draft.graph.edges.push(edge(map.get(current.from.nodeId), current.from.portId, map.get(current.to.nodeId), current.to.portId));
      }
    }
    draft.ui.selectedNodeIds = clones.map((node) => node.id);
  });
},

setParam(nodeId, paramId, value, history) {
  this.store.transact(`Set ${paramId}`, (draft) => {
    const node = findNode(draft.graph, nodeId);
    if (node) node.params[paramId] = value;
  }, { history });
},

undo() {
  this.clearPendingSwitchHistory();
  return this.store.undo();
},

redo() {
  this.clearPendingSwitchHistory();
  return this.store.redo();
},

commitGraphSnapshotHistory(label, snapshot = this.store.getState()) {
  this.store.commitHistorySnapshot(label, snapshot, captureGraphHistoryThumbnail(snapshot.graph));
},

randomGraph() {
  const now = performance.now();
  if (now < this.nextRandomGraphAt) return;
  this.nextRandomGraphAt = now + 50;
  this.clearPendingSwitchHistory();
  this.store.transact("Random Graph", (draft) => {
    const size = this.randomGraphSize();
    const branches = this.randomBranchCount(undefined, size);
    const connectedness = this.randomConnectedness();
    const edgeRandomness = this.randomEdgeRandomness(this.elements.randomEdgeRandomnessRange?.value);
    const mutationAmount = this.randomMutationAmount(this.elements.randomMutationRange?.value);
    draft.settings.randomGraphSize = size;
    draft.settings.randomBranchCount = branches;
    draft.settings.randomConnectedness = connectedness;
    draft.settings.randomEdgeRandomness = edgeRandomness;
    draft.settings.randomMutationAmount = mutationAmount;
    draft.graph = randomizeGraph(draft.settings, size, branches);
    draft.ui.selectedNodeIds = [draft.graph.outputNodeId];
  }, { history: false });
  this.commitGraphSnapshotHistory("Random Graph", this.store.getState());
  requestAnimationFrame(() => this.fitGraphToViewportWidth());
},

randomGraphSize(value = this.elements.randomSizeRange?.value || this.store.getState().settings.randomGraphSize || 6) {
  return Math.round(clamp(Number(value) || 6, 6, 15));
},

randomBranchCount(value = this.elements.randomBranchRange?.value || this.store.getState().settings.randomBranchCount || 2, size = this.randomGraphSize()) {
  return Math.round(clamp(Number(value) || 2, 2, this.maxRandomBranches(size)));
},

maxRandomBranches(size = this.randomGraphSize()) {
  return 6;
},

randomConnectedness(value = this.elements.randomConnectednessRange?.value || this.store.getState().settings.randomConnectedness || 2) {
  return Math.round(clamp(Number(value) || 2, 1, 5));
},

randomEdgeRandomness(value = this.store.getState().settings.randomEdgeRandomness ?? 0) {
  const numeric = Number(value);
  return Math.round(clamp(Number.isFinite(numeric) ? numeric : 0, 0, 3));
},

randomMutationAmount(value = this.store.getState().settings.randomMutationAmount ?? 0.35) {
  const numeric = Number(value);
  return Math.round(clamp(Number.isFinite(numeric) ? numeric : 0.35, 0, 1) * 100) / 100;
},

syncRandomControls(sizeValue, branchValue) {
  const size = this.randomGraphSize(sizeValue);
  const maxBranches = this.maxRandomBranches(size);
  const branches = this.randomBranchCount(branchValue, size);
  if (this.elements.randomSizeRange) this.elements.randomSizeRange.value = String(size);
  setText(this.elements.randomSizeValue, String(size));
  if (this.elements.randomBranchRange) {
    this.elements.randomBranchRange.min = "2";
    this.elements.randomBranchRange.max = String(maxBranches);
    this.elements.randomBranchRange.value = String(branches);
  }
  setText(this.elements.randomBranchValue, String(branches));
},

syncRandomConnectedness(value) {
  const connectedness = this.randomConnectedness(value);
  if (this.elements.randomConnectednessRange) this.elements.randomConnectednessRange.value = String(connectedness);
  setText(this.elements.randomConnectednessValue, String(connectedness));
},

syncRandomEdgeRandomness(value) {
  const randomness = this.randomEdgeRandomness(value);
  if (this.elements.randomEdgeRandomnessRange) this.elements.randomEdgeRandomnessRange.value = String(randomness);
  setText(this.elements.randomEdgeRandomnessValue, String(randomness));
},

setRandomEdgeRandomness(value) {
  const randomness = this.randomEdgeRandomness(value);
  this.syncRandomEdgeRandomness(randomness);
  this.store.transact("Change Randomness", (draft) => {
    draft.settings.randomEdgeRandomness = randomness;
  }, { history: false });
},

syncRandomMutation(value) {
  const amount = this.randomMutationAmount(value);
  if (this.elements.randomMutationRange) this.elements.randomMutationRange.value = String(amount);
  setText(this.elements.randomMutationValue, `${Math.round(amount * 100)}%`);
},

setRandomMutation(value) {
  const amount = this.randomMutationAmount(value);
  this.syncRandomMutation(amount);
  this.store.transact("Change Mutation", (draft) => {
    draft.settings.randomMutationAmount = amount;
  }, { history: false });
},

globalSpeedValue(value = this.store.getState().time.scale) {
  const numeric = Number(value);
  const safe = Number.isFinite(numeric) ? numeric : 1;
  return Math.round(clamp(safe, 0, 3) * 10) / 10;
},

syncGlobalSpeed(value) {
  const speed = this.globalSpeedValue(value);
  if (this.elements.globalSpeedRange) this.elements.globalSpeedRange.value = String(speed);
  setText(this.elements.globalSpeedValue, `${speed.toFixed(1)}x`);
},

setGlobalSpeed(value) {
  const speed = this.globalSpeedValue(value);
  this.syncGlobalSpeed(speed);
  this.store.transact("Change Global Speed", (draft) => {
    draft.time.scale = speed;
  }, { history: false });
},

randomSelectedNode() {
  const state = this.store.getState();
  const selected = state.ui.selectedNodeIds[0];
  if (!selected) return;
  this.store.transact("Randomize Node", (draft) => {
    const index = draft.graph.nodes.findIndex((node) => node.id === selected);
    if (index >= 0) draft.graph.nodes[index] = mutateNodeParams(draft.graph.nodes[index], draft.settings, this.randomMutationAmount());
  });
},

randomizeAllNodes() {
  this.clearPendingSwitchHistory();
  this.store.transact("Randomize Parameters and Edges", (draft) => {
    const graph = {
      ...draft.graph,
      nodes: draft.graph.nodes.map((node) => mutateNodeParams(node, draft.settings, this.randomMutationAmount()))
    };
    draft.settings.randomMutationAmount = this.randomMutationAmount();
    draft.graph = randomizeGraphEdges(graph, draft.settings);
  }, { history: false });
  this.commitGraphSnapshotHistory("Randomize Parameters and Edges", this.store.getState());
},

togglePlay() {
  this.store.transact("Toggle Playback", (draft) => {
    draft.time.playing = !draft.time.playing;
  });
}
};
