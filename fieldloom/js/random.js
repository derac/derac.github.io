import { GRAPH_HEIGHT, estimatedNodeHeight } from "./graph-metrics.js";
import { componentPortId, createNode, edge, getNodeDefinition } from "./nodes.js";

const FIELD_TYPES = [
  "sineWave", "radialWave", "noise", "fbmNoise", "fbmNoise", "ridgeNoise", "turbulenceNoise",
  "voronoi", "checker", "spiral", "sineLattice", "hexGrid", "plasma", "topographic", "tunnel",
  "metaballs", "truchetTiles", "sawWave", "glitchBlocks", "cyberRain", "circuitBoard",
  "quasicrystal", "moire", "polarGrid", "halftone", "sdfShape", "juliaFractal", "lightning",
  "starfield", "woodGrain", "marble", "iris", "roseCurve", "crtScanlines"
];
const DOMAIN_TYPES = ["translate", "scale", "rotate", "swirl", "mirror", "domainWarp", "kaleidoscope", "repeatDomain", "polarDomain", "pinchBulge", "waveWarp", "foldDomain", "glitchWarp"];
const COLOR_TYPES = ["colorRamp", "palette", "cosinePalette", "colorRamp5"];
const SCALAR_FILTER_TYPES = ["abs", "clamp", "smoothstep", "threshold", "remap", "invert", "powerCurve", "biasGain", "sineMath", "cosineMath", "fractValue", "modulo", "quantize", "normalizeCenter"];
const SCALAR_JOIN_TYPES = ["add", "multiply", "mix", "min", "max", "smoothMin", "smoothMax"];
const RANDOM_BRANCH_MAX = 6;
const GRAPH_TOP = 50;
const GRAPH_BOTTOM = 80;
const COLUMN_NODE_GAP = 34;
const MOTION_PARAM_INPUTS = new Set(["speed", "spin", "speedX", "speedY"]);
const SPATIAL_COMPONENT_INPUTS = new Set(["coordX", "coordY", "centerX", "centerY"]);

export function randomizeGraph(settings = {}, requestedSize = settings.randomGraphSize || 6, requestedBranches = settings.randomBranchCount || 2) {
  const requestedTargetSize = clampInt(requestedSize, 6, 15);
  const branchCount = clampInt(requestedBranches, 2, maxBranchesForSize());
  const targetSize = Math.max(requestedTargetSize, minimumNodeCount(branchCount));
  const builder = new GraphBuilder(settings);
  const audio = builder.add("audioInput", 0, "node_audio");
  builder.audioRef = builder.output(audio, "value");
  const branches = [];
  let remaining = targetSize - minimumNodeCount(branchCount);

  for (let i = 0; i < branchCount; i += 1) {
    let coordRef = null;
    if (remaining > 0 && shouldAddDomain(branchCount, remaining, i)) {
      const domain = builder.add(builder.pickType(DOMAIN_TYPES), 1 + i * 0.08);
      coordRef = coordOutputs(builder, domain);
      remaining -= 1;
    }

    const field = builder.add(builder.pickType(FIELD_TYPES), 2 + i * 0.08);
    if (coordRef) connectCoord(builder, coordRef, field, "coord");
    let scalarRef = builder.output(field, "value");

    if (remaining > 0 && Math.random() < 0.5) {
      const filter = builder.add(builder.pickType(SCALAR_FILTER_TYPES), 3 + i * 0.08);
      builder.connect(scalarRef, filter, "value");
      scalarRef = builder.output(filter, "value");
      remaining -= 1;
    }

    branches.push(scalarRef);
  }

  let scalarRef = joinScalarBranches(builder, branches, 4);

  let nextLevel = 5;
  while (remaining > 0) {
    if (remaining >= 3 && Math.random() < 0.45) {
      let coordRef = null;
      const domain = builder.add(builder.pickType(DOMAIN_TYPES), nextLevel);
      coordRef = coordOutputs(builder, domain);
      const field = builder.add(builder.pickType(FIELD_TYPES), nextLevel + 1);
      connectCoord(builder, coordRef, field, "coord");
      const join = builder.add(builder.pickType(SCALAR_JOIN_TYPES), nextLevel + 2);
      builder.connect(scalarRef, join, "a");
      builder.connect(builder.output(field, "value"), join, "b");
      scalarRef = builder.output(join, "value");
      remaining -= 3;
      nextLevel += 3;
      continue;
    }

    if (remaining >= 2 && Math.random() < 0.58) {
      const field = builder.add(builder.pickType(FIELD_TYPES), nextLevel);
      const join = builder.add(builder.pickType(SCALAR_JOIN_TYPES), nextLevel + 1);
      builder.connect(scalarRef, join, "a");
      builder.connect(builder.output(field, "value"), join, "b");
      scalarRef = builder.output(join, "value");
      remaining -= 2;
      nextLevel += 2;
      continue;
    }

    const filter = builder.add(builder.pickType(SCALAR_FILTER_TYPES), nextLevel);
    builder.connect(scalarRef, filter, "value");
    scalarRef = builder.output(filter, "value");
    remaining -= 1;
    nextLevel += 1;
  }

  const color = builder.add(builder.pickType(COLOR_TYPES), nextLevel);
  builder.connect(scalarRef, color, "value");
  const colorRef = colorOutputs(builder, color);

  const output = builder.add("output", nextLevel + 1, "node_output");
  connectColor(builder, colorRef, output, "color");
  return builder.finish(output.id);
}

export function randomizeGraphEdges(graph, settings = {}) {
  const clone = structuredClone(graph);
  const depthByNode = depthsFromPositions(clone.nodes);
  perturbEdges(clone.nodes, clone.edges, clone.outputNodeId, depthByNode, settings);
  fillGraphEdgesToMinimum(clone.nodes, clone.edges, clone.outputNodeId, depthByNode, settings);
  return clone;
}

export function randomizeNodeParams(node, settings = {}) {
  return mutateNodeParams(node, settings, 1);
}

export function mutateNodeParams(node, settings = {}, amount = settings.randomMutationAmount ?? 1) {
  const def = getNodeDefinition(node.type);
  if (!def) return node;
  const clone = structuredClone(node);
  const strength = mutationAmount(amount);
  for (const param of def.params) {
    const target = randomParamValue(node.type, param, settings);
    clone.params[param.id] = mutateParamValue(clone.params[param.id] ?? param.default, target, param, strength);
  }
  return clone;
}

export function writeRandomBound(state, type, paramId, boundKey, value) {
  const defaults = state.settings.randomDefaults || {};
  const nodeDefaults = defaults[type] || {};
  const paramDefaults = nodeDefaults[paramId] || {};
  const param = getNodeDefinition(type)?.params.find((candidate) => candidate.id === paramId);
  const numeric = Number(value);
  const bounded = param && Number.isFinite(numeric) ? clamp(numeric, param.min, param.max) : numeric;
  return {
    ...state.settings,
    randomDefaults: {
      ...defaults,
      [type]: {
        ...nodeDefaults,
        [paramId]: {
          ...paramDefaults,
          [boundKey]: bounded
        }
      }
    }
  };
}

class GraphBuilder {
  constructor(settings) {
    this.settings = settings;
    this.connectedness = randomConnectedness(settings.randomConnectedness);
    this.audioRef = null;
    this.nodes = [];
    this.levels = new Map();
    this.plannedEdges = [];
    this.filledInputs = new Set();
    this.outputUsage = new Map();
  }

  add(type, level, id = undefined) {
    const node = randomizeNodeParams(createNode(type, { x: 80, y: 120 }, id), this.settings);
    this.nodes.push(node);
    this.levels.set(node.id, level);
    return node;
  }

  output(node, portId) {
    const def = getNodeDefinition(node.type);
    const port = def?.outputs.find((candidate) => candidate.id === portId);
    if (!port) throw new Error(`Missing output port ${node.type}.${portId}`);
    return { nodeId: node.id, portId, level: this.levels.get(node.id) || 0 };
  }

  pickType(types) {
    return pick(typesMeetingEdgeMinimum(types, this.connectedness));
  }

  connect(fromRef, toNode, toPortId) {
    const inputKey = `${toNode.id}:${toPortId}`;
    if (this.filledInputs.has(inputKey)) return false;
    this.plannedEdges.push(edge(fromRef.nodeId, fromRef.portId, toNode.id, toPortId));
    this.filledInputs.add(inputKey);
    this.incrementOutputUsage(fromRef);
    return true;
  }

  finish(outputNodeId) {
    this.fillOptionalInputs();
    this.applyEdgeRandomness(outputNodeId);
    this.fillOptionalInputs();
    const depthByNode = this.depthsFromPlannedEdges();
    this.layout(depthByNode);
    return {
      nodes: this.nodes,
      edges: this.plannedEdges,
      outputNodeId
    };
  }

  fillOptionalInputs() {
    const depthByNode = this.depthsFromPlannedEdges();
    const nodes = shuffle([...this.nodes]).sort((a, b) => {
      const depthOrder = (depthByNode.get(b.id) ?? 0) - (depthByNode.get(a.id) ?? 0);
      return depthOrder || (this.levels.get(b.id) || 0) - (this.levels.get(a.id) || 0);
    });
    for (const node of nodes) {
      while (this.incomingEdgeCount(node.id) < this.connectedness) {
        const candidates = this.optionalCandidatesForNode(node);
        if (!candidates.length) break;
        let connected = false;
        for (const candidate of candidates) {
          if (this.connect(candidate.source, node, candidate.input.id)) {
            connected = true;
            break;
          }
        }
        if (!connected) break;
      }
    }
  }

  optionalCandidatesForNode(node) {
    const candidates = [];
    const def = getNodeDefinition(node.type);
    if (!def) return candidates;
    for (const input of shuffle(def.inputs.filter((candidate) => !candidate.required))) {
      if (SPATIAL_COMPONENT_INPUTS.has(input.id)) continue;
      if (input.paramInput && MOTION_PARAM_INPUTS.has(input.paramId)) continue;
      const inputKey = `${node.id}:${input.id}`;
      if (this.filledInputs.has(inputKey)) continue;
      const source = this.pickOptionalSource(input, node);
      if (!source) continue;
      candidates.push({
        input,
        source,
        priority: optionalEdgePriority(input) + (source.audio ? 0.2 : 0) + Math.random() * 0.35
      });
    }
    return candidates.sort((a, b) => b.priority - a.priority);
  }

  incomingEdgeCount(nodeId) {
    return this.plannedEdges.reduce((count, current) => count + (current.to.nodeId === nodeId ? 1 : 0), 0);
  }

  canUseAudioInput(input, node) {
    if (!this.audioRef || input.id === "time" || node.type === "audioInput") return false;
    return true;
  }

  pickOptionalSource(input, node) {
    const beforeLevel = this.levels.get(node.id) || 0;
    let candidates = this.sourceCandidates(beforeLevel);
    if (this.audioRef) {
      candidates = candidates.filter((candidate) => candidate.nodeId !== this.audioRef.nodeId || candidate.portId !== this.audioRef.portId);
    }
    if (this.canUseAudioInput(input, node)) {
      const key = `${this.audioRef.nodeId}:${this.audioRef.portId}`;
      candidates.push({
        ...this.audioRef,
        usage: this.outputUsage.get(key) || 0,
        audio: true
      });
    }
    if (!candidates.length) return null;
    candidates.sort((a, b) => {
      const timePreference = timeSourcePriority(input, b) - timeSourcePriority(input, a);
      const audioPreference = audioSourcePriority(input, b) - audioSourcePriority(input, a);
      return timePreference || audioPreference || a.usage - b.usage || b.level - a.level || Math.random() - 0.5;
    });
    const window = candidates.slice(0, Math.min(candidates.length, input.paramInput ? 4 : 3));
    return pick(window);
  }

  sourceCandidates(beforeLevel) {
    const candidates = [];
    for (const node of this.nodes) {
      const level = this.levels.get(node.id) || 0;
      if (level >= beforeLevel) continue;
      const def = getNodeDefinition(node.type);
      for (const port of def?.outputs || []) {
        const key = `${node.id}:${port.id}`;
        candidates.push({
          nodeId: node.id,
          portId: port.id,
          nodeType: node.type,
          level,
          usage: this.outputUsage.get(key) || 0
        });
      }
    }
    return candidates;
  }

  applyEdgeRandomness(outputNodeId) {
    perturbEdges(this.nodes, this.plannedEdges, outputNodeId, this.depthsFromPlannedEdges(), this.settings, {
      onRemove: (current) => {
        this.filledInputs.delete(`${current.to.nodeId}:${current.to.portId}`);
        this.decrementOutputUsage(current.from);
      },
      onAdd: (current) => {
        this.filledInputs.add(`${current.to.nodeId}:${current.to.portId}`);
        this.incrementOutputUsage(current.from);
      }
    });
  }

  incrementOutputUsage(source) {
    const key = `${source.nodeId}:${source.portId}`;
    this.outputUsage.set(key, (this.outputUsage.get(key) || 0) + 1);
  }

  decrementOutputUsage(source) {
    const key = `${source.nodeId}:${source.portId}`;
    const next = (this.outputUsage.get(key) || 0) - 1;
    if (next > 0) this.outputUsage.set(key, next);
    else this.outputUsage.delete(key);
  }

  layout(depthByNode = this.depthsFromPlannedEdges()) {
    const groups = new Map();
    for (const node of this.nodes) {
      const depth = depthByNode.get(node.id) ?? 0;
      const list = groups.get(depth) || [];
      list.push(node);
      groups.set(depth, list);
    }
    const depths = [...groups.keys()].sort((a, b) => a - b);
    const xStep = Math.min(250, 2460 / Math.max(1, depths.length - 1));
    depths.forEach((depth, depthIndex) => {
      const nodes = groups.get(depth);
      nodes.sort((a, b) => a.type.localeCompare(b.type) || a.id.localeCompare(b.id));
      const heights = nodes.map((node) => estimatedNodeHeight(node, getNodeDefinition));
      const heightSum = heights.reduce((sum, height) => sum + height, 0);
      const totalHeight = heightSum + Math.max(0, nodes.length - 1) * COLUMN_NODE_GAP;
      const availableHeight = GRAPH_HEIGHT - GRAPH_TOP - GRAPH_BOTTOM;
      const compressedGap = totalHeight > availableHeight && nodes.length > 1
        ? Math.max(22, (availableHeight - heightSum) / (nodes.length - 1))
        : COLUMN_NODE_GAP;
      const actualHeight = heightSum + Math.max(0, nodes.length - 1) * compressedGap;
      const maxStartY = GRAPH_HEIGHT - GRAPH_BOTTOM - actualHeight;
      let y = actualHeight <= availableHeight
        ? clamp((GRAPH_HEIGHT - actualHeight) / 2 + (Math.random() - 0.5) * 26, GRAPH_TOP, maxStartY)
        : GRAPH_TOP;
      nodes.forEach((node, index) => {
        node.position.x = Math.round(clamp(80 + depthIndex * xStep, 40, 2580));
        node.position.y = Math.round(Math.max(GRAPH_TOP, y));
        y += heights[index] + compressedGap;
      });
    });
  }

  depthsFromPlannedEdges() {
    const depth = new Map(this.nodes.map((node) => [node.id, Number.NEGATIVE_INFINITY]));
    for (const node of this.nodes) {
      if ((this.levels.get(node.id) || 0) <= 0) depth.set(node.id, 0);
    }
    for (let pass = 0; pass < this.nodes.length; pass += 1) {
      let changed = false;
      for (const current of this.plannedEdges) {
        const fromDepth = depth.get(current.from.nodeId);
        if (!Number.isFinite(fromDepth)) continue;
        const nextDepth = fromDepth + 1;
        if (nextDepth > (depth.get(current.to.nodeId) ?? Number.NEGATIVE_INFINITY)) {
          depth.set(current.to.nodeId, nextDepth);
          changed = true;
        }
      }
      if (!changed) break;
    }
    for (const node of this.nodes) {
      if (!Number.isFinite(depth.get(node.id))) {
        depth.set(node.id, Math.max(0, Math.round(this.levels.get(node.id) || 0)));
      }
    }
    return depth;
  }
}

function joinScalarBranches(builder, branches, level) {
  let queue = shuffle([...branches]);
  let round = 0;
  while (queue.length > 1) {
    const next = [];
    for (let i = 0; i < queue.length; i += 2) {
      if (!queue[i + 1]) {
        next.push(queue[i]);
        continue;
      }
      const join = builder.add(builder.pickType(SCALAR_JOIN_TYPES), level + round * 0.55 + i * 0.04);
      builder.connect(queue[i], join, "a");
      builder.connect(queue[i + 1], join, "b");
      next.push(builder.output(join, "value"));
    }
    queue = next;
    round += 1;
  }
  return queue[0];
}

function coordOutputs(builder, node) {
  return {
    x: builder.output(node, componentPortId("coord", "X")),
    y: builder.output(node, componentPortId("coord", "Y"))
  };
}

function connectCoord(builder, ref, node, inputId) {
  builder.connect(ref.x, node, componentPortId(inputId, "X"));
  builder.connect(ref.y, node, componentPortId(inputId, "Y"));
}

function colorOutputs(builder, node) {
  return {
    r: builder.output(node, componentPortId("color", "R")),
    g: builder.output(node, componentPortId("color", "G")),
    b: builder.output(node, componentPortId("color", "B")),
    a: builder.output(node, componentPortId("color", "A"))
  };
}

function connectColor(builder, ref, node, inputId) {
  builder.connect(ref.r, node, componentPortId(inputId, "R"));
  builder.connect(ref.g, node, componentPortId(inputId, "G"));
  builder.connect(ref.b, node, componentPortId(inputId, "B"));
  builder.connect(ref.a, node, componentPortId(inputId, "A"));
}

function perturbEdges(nodes, edges, outputNodeId, depthByNode, settings = {}, hooks = {}) {
  const attempts = randomEdgeRandomness(settings.randomEdgeRandomness);
  if (attempts <= 0 || !edges.length) return;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (!edges.length) return;
    const current = pick(shuffle(edges));
    const target = nodes.find((node) => node.id === current.to.nodeId);
    const input = getNodeDefinition(target?.type)?.inputs.find((port) => port.id === current.to.portId);
    if (!target || !input) continue;

    const index = edges.findIndex((candidate) => candidate.id === current.id);
    if (index < 0) continue;
    edges.splice(index, 1);
    hooks.onRemove?.(current);

    let candidates = sourceCandidatesForInput(nodes, input, target, depthByNode, outputNodeId)
      .filter((source) => source.nodeId !== current.from.nodeId || source.portId !== current.from.portId);
    if (!candidates.length && input.required) {
      candidates = sourceCandidatesForInput(nodes, input, target, depthByNode, outputNodeId);
    }
    const source = weightedSourcePick(candidates, target, input, depthByNode, input.required);
    if (source) {
      const next = edge(source.nodeId, source.portId, target.id, input.id);
      edges.push(next);
      hooks.onAdd?.(next);
      continue;
    }

    if (input.required) {
      edges.push(current);
      hooks.onAdd?.(current);
    }
  }
}

function fillGraphEdgesToMinimum(nodes, edges, outputNodeId, depthByNode, settings = {}) {
  const minimumEdges = randomConnectedness(settings.randomConnectedness);
  const filledInputs = new Set(edges.map((current) => `${current.to.nodeId}:${current.to.portId}`));
  const targets = shuffle([...nodes]).sort((a, b) => {
    const depthOrder = (depthByNode.get(b.id) ?? 0) - (depthByNode.get(a.id) ?? 0);
    return depthOrder || a.id.localeCompare(b.id);
  });

  for (const node of targets) {
    while (incomingGraphEdgeCount(edges, node.id) < minimumEdges) {
      const candidates = optionalGraphEdgeCandidates(nodes, node, filledInputs, depthByNode, outputNodeId);
      if (!candidates.length) break;
      const candidate = candidates[0];
      const next = edge(candidate.source.nodeId, candidate.source.portId, node.id, candidate.input.id);
      edges.push(next);
      filledInputs.add(`${node.id}:${candidate.input.id}`);
    }
  }
}

function optionalGraphEdgeCandidates(nodes, target, filledInputs, depthByNode, outputNodeId) {
  const def = getNodeDefinition(target.type);
  if (!def) return [];
  const candidates = [];
  for (const input of shuffle(def.inputs.filter((candidate) => !candidate.required))) {
    if (SPATIAL_COMPONENT_INPUTS.has(input.id)) continue;
    if (input.paramInput && MOTION_PARAM_INPUTS.has(input.paramId)) continue;
    if (filledInputs.has(`${target.id}:${input.id}`)) continue;
    const source = weightedSourcePick(
      sourceCandidatesForInput(nodes, input, target, depthByNode, outputNodeId),
      target,
      input,
      depthByNode,
      false
    );
    if (!source) continue;
    candidates.push({
      input,
      source,
      priority: optionalEdgePriority(input) + Math.random() * 0.35
    });
  }
  return candidates.sort((a, b) => b.priority - a.priority);
}

function incomingGraphEdgeCount(edges, nodeId) {
  return edges.reduce((count, current) => count + (current.to.nodeId === nodeId ? 1 : 0), 0);
}

function sourceCandidatesForInput(nodes, input, target, depthByNode, outputNodeId) {
  const targetDepth = depthByNode.get(target.id) ?? 0;
  const candidates = [];
  for (const node of nodes) {
    if (node.id === target.id || node.id === outputNodeId || node.type === "output") continue;
    const sourceDepth = depthByNode.get(node.id) ?? 0;
    if (sourceDepth >= targetDepth) continue;
    const def = getNodeDefinition(node.type);
    for (const port of def?.outputs || []) {
      candidates.push({
        nodeId: node.id,
        portId: port.id,
        category: def.category,
        depth: sourceDepth
      });
    }
  }
  return candidates;
}

function weightedSourcePick(candidates, target, input, depthByNode, required) {
  const weighted = candidates
    .map((source) => ({
      source,
      weight: sourceWeight(source, target, input, depthByNode)
    }))
    .filter((candidate) => candidate.weight > 0);
  if (!weighted.length) return required ? pick(candidates) : null;
  const total = weighted.reduce((sum, candidate) => sum + candidate.weight, 0);
  let threshold = Math.random() * total;
  for (const candidate of weighted) {
    threshold -= candidate.weight;
    if (threshold <= 0) return candidate.source;
  }
  return weighted[weighted.length - 1].source;
}

function sourceWeight(source, target, input, depthByNode) {
  const targetSegment = graphSegment(getNodeDefinition(target.type)?.category);
  const sourceSegment = graphSegment(source.category);
  const targetDepth = depthByNode.get(target.id) ?? 0;
  const depthGap = Math.max(1, targetDepth - source.depth);
  let weight = depthGap === 1 ? 3.2 : depthGap === 2 ? 1.7 : 0.8 / Math.sqrt(depthGap);

  if (targetSegment === "output") {
    weight *= sourceSegment === "color" ? 14 : sourceSegment === "core" ? 1.8 : 0.35;
  } else if (targetSegment === "color") {
    weight *= sourceSegment === "color" ? 8 : sourceSegment === "core" ? 7 : sourceSegment === "input" ? 1.2 : 0.8;
  } else if (targetSegment === "core") {
    weight *= sourceSegment === "core" ? 9 : sourceSegment === "input" ? 1.8 : sourceSegment === "color" ? 0.45 : 0.8;
  } else {
    weight *= sourceSegment === targetSegment ? 3 : 1;
  }

  if (input.paramInput) weight *= 0.65;
  return weight + Math.random() * 0.05;
}

function graphSegment(category = "") {
  if (category === "Output") return "output";
  if (category === "Coloring") return "color";
  if (category === "Field" || category === "Domain" || category === "Math") return "core";
  if (category === "Input") return "input";
  return "other";
}

function typesMeetingEdgeMinimum(types, minimumEdges) {
  const candidates = types.filter((type) => connectableInputCapacity(type) >= minimumEdges);
  return candidates.length ? candidates : types;
}

function connectableInputCapacity(type) {
  const def = getNodeDefinition(type);
  if (!def) return 0;
  return def.inputs.filter((input) => {
    if (SPATIAL_COMPONENT_INPUTS.has(input.id)) return false;
    if (input.paramInput && MOTION_PARAM_INPUTS.has(input.paramId)) return false;
    return true;
  }).length;
}

function depthsFromPositions(nodes) {
  const columns = [...new Set(nodes.map((node) => positionColumn(node)))]
    .sort((a, b) => a - b);
  const depthByColumn = new Map(columns.map((column, index) => [column, index]));
  return new Map(nodes.map((node) => [node.id, depthByColumn.get(positionColumn(node)) ?? 0]));
}

function positionColumn(node) {
  return Math.round((Number(node.position?.x) || 0) / 8) * 8;
}

function shouldAddDomain(branchCount, remaining, index) {
  if (remaining <= 0) return false;
  if (branchCount > 2 && index < branchCount - 1 && Math.random() < 0.64) return true;
  return Math.random() < 0.46;
}

function optionalEdgePriority(input) {
  if (input.paramInput) {
    if (input.paramType === "color") return 0.55;
    if (input.paramType === "select" || input.paramType === "toggle") return 0.35;
    return 0.9;
  }
  return 2.7;
}

function audioSourcePriority(input, source) {
  if (!source.audio) return 0;
  return input.paramInput ? 1.1 : 0.55;
}

function timeSourcePriority(input, source) {
  if (input.id !== "time") return 0;
  return source.nodeType === "time" ? 1.0 : 0;
}

function minimumNodeCount(branchCount) {
  return branchCount * 2 + 2;
}

function maxBranchesForSize() {
  return RANDOM_BRANCH_MAX;
}

function randomConnectedness(value = 2) {
  return clampInt(value, 1, 5);
}

function randomEdgeRandomness(value = 0) {
  return clampInt(value, 0, 3);
}

function mutationAmount(value = 1) {
  const numeric = Number(value);
  return clamp(Number.isFinite(numeric) ? numeric : 1, 0, 1);
}

function mutateParamValue(current, target, param, amount) {
  if (amount >= 0.999) return target;
  if (amount <= 0.001) return current;
  if (param.type === "color") return mixColor(current, target, amount);
  if (param.type === "toggle") return Math.random() < amount ? target : Boolean(current);
  if (param.type === "select") return Math.random() < amount ? target : current;
  const currentNumber = Number(current);
  const targetNumber = Number(target);
  const fallback = Number(param.default) || 0;
  const raw = (Number.isFinite(currentNumber) ? currentNumber : fallback) * (1 - amount)
    + (Number.isFinite(targetNumber) ? targetNumber : fallback) * amount;
  const min = Number.isFinite(param.min) ? param.min : raw;
  const max = Number.isFinite(param.max) ? param.max : raw;
  return roundToStep(clamp(raw, min, max), param.step || 0.001);
}

function randomParamValue(type, param, settings) {
  if (param.type === "color") return randomColor();
  if (param.type === "toggle") return Math.random() > 0.5;
  if (param.type === "select") return pick(param.options).value;
  const stored = settings?.randomDefaults?.[type]?.[param.id] || {};
  const defaultMin = param.random?.min ?? param.min ?? 0;
  const defaultMax = param.random?.max ?? param.max ?? 1;
  const min = clamp(Number.isFinite(stored.min) ? stored.min : defaultMin, param.min ?? defaultMin, param.max ?? defaultMax);
  const max = clamp(Number.isFinite(stored.max) ? stored.max : defaultMax, param.min ?? defaultMin, param.max ?? defaultMax);
  const step = param.step || 0.001;
  const raw = Math.min(min, max) + Math.random() * Math.abs(max - min);
  return roundToStep(raw, step);
}

function roundToStep(value, step = 0.001) {
  return Math.round(value / step) * step;
}

function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function shuffle(values) {
  const copy = [...values];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function clampInt(value, min, max) {
  return Math.round(clamp(Number(value) || min, min, max));
}

function randomColor() {
  const hue = Math.random();
  const sat = 0.55 + Math.random() * 0.4;
  const val = 0.45 + Math.random() * 0.5;
  return hsvToHex(hue, sat, val);
}

function mixColor(current, target, amount) {
  const a = parseHexColor(current);
  const b = parseHexColor(target);
  return `#${toHex(a[0] * (1 - amount) + b[0] * amount)}${toHex(a[1] * (1 - amount) + b[1] * amount)}${toHex(a[2] * (1 - amount) + b[2] * amount)}`;
}

function parseHexColor(value) {
  const safe = typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value : "#ffffff";
  return [
    parseInt(safe.slice(1, 3), 16) / 255,
    parseInt(safe.slice(3, 5), 16) / 255,
    parseInt(safe.slice(5, 7), 16) / 255
  ];
}

function hsvToHex(h, s, v) {
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  const mod = i % 6;
  const [r, g, b] = mod === 0 ? [v, t, p] : mod === 1 ? [q, v, p] : mod === 2 ? [p, v, t] : mod === 3 ? [p, q, v] : mod === 4 ? [t, p, v] : [v, p, q];
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function toHex(value) {
  return Math.round(value * 255).toString(16).padStart(2, "0");
}
