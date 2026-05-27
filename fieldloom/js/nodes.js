import { GRAPH_HEIGHT, estimatedNodeHeightFromCounts } from "./graph-metrics.js";
import { createRawNodeDefinitions } from "./node-definitions.js";

let idCounter = 1;

export function makeId(prefix = "node") {
  idCounter += 1;
  return `${prefix}_${Date.now().toString(36)}_${idCounter.toString(36)}`;
}

const SCALAR_TYPE = "scalar";
const input = (id, label, required = false, fallback = null) => ({ id, type: SCALAR_TYPE, label, required, fallback });
const PARAM_INPUT_PREFIX = "param_";
export function componentPortId(portId, suffix) {
  return `${portId}${suffix}`;
}

export function paramInputId(paramId, suffix = "") {
  return `${PARAM_INPUT_PREFIX}${paramId}${suffix ? `_${suffix}` : ""}`;
}

export const NODE_DEFINITIONS = Object.freeze(createRawNodeDefinitions());

indexScalarPortGroups(NODE_DEFINITIONS);
addParameterInputs(NODE_DEFINITIONS);

function indexScalarPortGroups(definitions) {
  for (const def of Object.values(definitions)) {
    def.scalarInputs = groupScalarPorts(def.inputs);
    def.scalarOutputs = groupScalarPorts(def.outputs);
  }
}

function groupScalarPorts(ports) {
  const byId = new Map(ports.map((port) => [port.id, port]));
  const groups = {};
  for (const port of ports) {
    if (port.id.endsWith("X")) {
      const id = port.id.slice(0, -1);
      if (byId.has(componentPortId(id, "Y"))) {
        groups[id] = scalarPortGroup(id, "vec2f", [
          ["X", "x"],
          ["Y", "y"]
        ], byId);
      }
    } else if (port.id.endsWith("R")) {
      const id = port.id.slice(0, -1);
      if (["G", "B", "A"].every((suffix) => byId.has(componentPortId(id, suffix)))) {
        groups[id] = scalarPortGroup(id, "vec4f", [
          ["R", "x"],
          ["G", "y"],
          ["B", "z"],
          ["A", "w"]
        ], byId);
      }
    }
  }
  return groups;
}

function scalarPortGroup(id, constructor, components, portsById) {
  return {
    id,
    constructor,
    components: components.map(([suffix, accessor]) => {
      const port = portsById.get(componentPortId(id, suffix));
      return {
        id: port.id,
        accessor,
        suffix,
        fallback: port.fallback
      };
    })
  };
}

function addParameterInputs(definitions) {
  for (const def of Object.values(definitions)) {
    const existing = new Set(def.inputs.map((port) => port.id));
    for (const param of def.params) {
      if (param.type === "color") {
        addColorParameterInput(def, existing, param, "R", "x", "r");
        addColorParameterInput(def, existing, param, "G", "y", "g");
        addColorParameterInput(def, existing, param, "B", "z", "b");
        addColorParameterInput(def, existing, param, "A", "w", "a");
        continue;
      }
      const id = paramInputId(param.id);
      if (existing.has(id)) continue;
      def.inputs.push({
        ...input(id, `${param.label} mod`),
        paramInput: true,
        paramId: param.id,
        paramType: param.type
      });
      existing.add(id);
    }
  }
}

function addColorParameterInput(def, existing, param, suffix, accessor, label) {
  const id = paramInputId(param.id, suffix);
  if (existing.has(id)) return;
  def.inputs.push({
    ...input(id, `${param.label} ${label} mod`),
    paramInput: true,
    paramId: param.id,
    paramType: param.type,
    paramComponent: accessor,
    paramComponentSuffix: suffix
  });
  existing.add(id);
}

export function getNodeDefinition(type) {
  return NODE_DEFINITIONS[type] || null;
}

export function getNodeTypes() {
  return Object.values(NODE_DEFINITIONS).filter((def) => !def.hideInMenu);
}

function defaultParams(type) {
  const def = getNodeDefinition(type);
  const params = {};
  if (!def) return params;
  for (const param of def.params) {
    params[param.id] = param.default;
  }
  return params;
}

export function createNode(type, position = { x: 120, y: 120 }, id = makeId("node")) {
  const def = getNodeDefinition(type);
  if (!def) throw new Error(`Unknown node type: ${type}`);
  return {
    id,
    type,
    position: { x: position.x, y: position.y },
    params: defaultParams(type),
    ports: {
      inputs: def.inputs.map((port) => ({ ...port })),
      outputs: def.outputs.map((port) => ({ ...port }))
    }
  };
}

export function normalizeGraphPorts(graph) {
  if (!graph) return graph;
  const clone = structuredClone(graph);
  clone.nodes = (clone.nodes || []).map((node) => {
    const def = getNodeDefinition(node.type);
    if (!def) return node;
    return {
      ...node,
      ports: {
        inputs: def.inputs.map((port) => ({ ...port })),
        outputs: def.outputs.map((port) => ({ ...port }))
      }
    };
  });
  return clone;
}

export function createStarterGraph() {
  const nodes = [
    createNode("fbmNoise", { x: 80, y: 0 }, "node_fbm"),
    createNode("colorRamp", { x: 330, y: 0 }, "node_ramp"),
    createNode("output", { x: 580, y: 0 }, "node_output")
  ];
  for (const node of nodes) {
    node.position.y = centeredStarterY(node);
  }
  const edges = [
    edge("node_fbm", "value", "node_ramp", "value"),
    edge("node_ramp", componentPortId("color", "R"), "node_output", componentPortId("color", "R")),
    edge("node_ramp", componentPortId("color", "G"), "node_output", componentPortId("color", "G")),
    edge("node_ramp", componentPortId("color", "B"), "node_output", componentPortId("color", "B")),
    edge("node_ramp", componentPortId("color", "A"), "node_output", componentPortId("color", "A"))
  ];
  return { nodes, edges, outputNodeId: "node_output" };
}

function centeredStarterY(node) {
  const height = estimatedNodeHeightFromCounts(node.ports.inputs.length, node.ports.outputs.length);
  return Math.round((GRAPH_HEIGHT - height) / 2);
}

export function edge(fromNodeId, fromPortId, toNodeId, toPortId) {
  return {
    id: makeId("edge"),
    from: { nodeId: fromNodeId, portId: fromPortId },
    to: { nodeId: toNodeId, portId: toPortId }
  };
}

export function findNode(graph, nodeId) {
  return graph.nodes.find((node) => node.id === nodeId) || null;
}

export function findPort(node, direction, portId) {
  const def = getNodeDefinition(node.type);
  if (!def) return null;
  const ports = direction === "input" ? def.inputs : def.outputs;
  return ports.find((port) => port.id === portId) || null;
}

export function getEdgePortTypes(graph, current) {
  const fromNode = findNode(graph, current.from.nodeId);
  const toNode = findNode(graph, current.to.nodeId);
  const fromPort = fromNode ? findPort(fromNode, "output", current.from.portId) : null;
  const toPort = toNode ? findPort(toNode, "input", current.to.portId) : null;
  if (!fromPort || !toPort) return null;
  return { fromType: SCALAR_TYPE, toType: SCALAR_TYPE, fromPort, toPort };
}

function findInsertionOptions() {
  return getNodeTypes()
    .filter((def) => def.type !== "output" && def.inputs.length && def.outputs.length)
    .map((def) => {
      const inputPort = pickPort(def.inputs);
      const outputPort = pickPort(def.outputs);
      return inputPort && outputPort ? { def, inputPort, outputPort } : null;
    })
    .filter(Boolean);
}

export function findEdgeInsertionOptions(graph, current) {
  const types = getEdgePortTypes(graph, current);
  if (!types) return [];
  return findInsertionOptions();
}

export function canConnect(graph, from, to) {
  if (!from || !to || from.nodeId === to.nodeId) {
    return { ok: false, reason: "Connect different nodes." };
  }
  const fromNode = findNode(graph, from.nodeId);
  const toNode = findNode(graph, to.nodeId);
  if (!fromNode || !toNode) return { ok: false, reason: "Missing node." };
  const fromPort = findPort(fromNode, "output", from.portId);
  const toPort = findPort(toNode, "input", to.portId);
  if (!fromPort || !toPort) return { ok: false, reason: "Missing port." };
  const testGraph = {
    ...graph,
    edges: [
      ...graph.edges.filter((candidate) => !(candidate.to.nodeId === to.nodeId && candidate.to.portId === to.portId)),
      edge(from.nodeId, from.portId, to.nodeId, to.portId)
    ]
  };
  if (hasCycle(testGraph)) return { ok: false, reason: "Connection would create a cycle." };
  return { ok: true, reason: "" };
}

function pickPort(ports) {
  return ports.find((port) => port.required) || ports[0] || null;
}

function hasCycle(graph) {
  const visiting = new Set();
  const visited = new Set();
  const incomingByNode = new Map();
  for (const current of graph.edges) {
    const list = incomingByNode.get(current.to.nodeId) || [];
    list.push(current.from.nodeId);
    incomingByNode.set(current.to.nodeId, list);
  }
  const visit = (nodeId) => {
    if (visiting.has(nodeId)) return true;
    if (visited.has(nodeId)) return false;
    visiting.add(nodeId);
    for (const parent of incomingByNode.get(nodeId) || []) {
      if (visit(parent)) return true;
    }
    visiting.delete(nodeId);
    visited.add(nodeId);
    return false;
  };
  return graph.nodes.some((node) => visit(node.id));
}

export function graphSignature(graph) {
  const nodeBits = graph.nodes
    .map((node) => `${node.id}:${node.type}`)
    .sort()
    .join("|");
  const edgeBits = graph.edges
    .map((current) => `${current.from.nodeId}.${current.from.portId}->${current.to.nodeId}.${current.to.portId}`)
    .sort()
    .join("|");
  return `${graph.outputNodeId || ""}::${nodeBits}::${edgeBits}`;
}
