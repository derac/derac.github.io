export const NODE_WIDTH = 188;
export const HEADER_HEIGHT = 32;
const PORT_TOP = 51;
const PORT_STEP = 24;
export const GRAPH_WIDTH = 2800;
export const GRAPH_HEIGHT = 4200;
const NODE_BODY_VERTICAL_PADDING = 14;
const NODE_BORDER_HEIGHT = 2;
const NODE_HEIGHT_SAFETY = 12;

export function estimatedNodeHeightFromCounts(inputCount = 0, outputCount = 0) {
  const rowCount = Math.max(inputCount || 0, outputCount || 0, 1);
  return HEADER_HEIGHT + NODE_BODY_VERTICAL_PADDING + NODE_BORDER_HEIGHT + NODE_HEIGHT_SAFETY + rowCount * PORT_STEP;
}

export function estimatedNodeHeight(node, getNodeDefinition) {
  const def = getNodeDefinition(node.type);
  return estimatedNodeHeightFromCounts(def?.inputs.length || 0, def?.outputs.length || 0);
}

export function graphBounds(nodes, getNodeDefinition) {
  return nodes.reduce((bounds, node) => {
    const height = estimatedNodeHeight(node, getNodeDefinition);
    return {
      minX: Math.min(bounds.minX, node.position.x),
      minY: Math.min(bounds.minY, node.position.y),
      maxX: Math.max(bounds.maxX, node.position.x + NODE_WIDTH),
      maxY: Math.max(bounds.maxY, node.position.y + height)
    };
  }, {
    minX: Number.POSITIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY
  });
}

export function portPoint(node, portId, direction, getNodeDefinition) {
  const def = getNodeDefinition(node.type);
  const ports = direction === "input" ? def.inputs : def.outputs;
  const index = Math.max(0, ports.findIndex((port) => port.id === portId));
  return {
    x: node.position.x + (direction === "output" ? NODE_WIDTH : 0),
    y: node.position.y + PORT_TOP + index * PORT_STEP
  };
}

export function curvedPath(a, b) {
  const delta = Math.max(70, Math.abs(b.x - a.x) * 0.5);
  return `M ${a.x} ${a.y} C ${a.x + delta} ${a.y}, ${b.x - delta} ${b.y}, ${b.x} ${b.y}`;
}
