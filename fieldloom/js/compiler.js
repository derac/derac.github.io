import { NODE_DEFINITIONS, findNode, getNodeDefinition, paramInputId } from "./nodes.js";

const WGSL_HELPERS = `
fn hash21(p: vec2f) -> f32 {
  let h = dot(p, vec2f(127.1, 311.7));
  return fract(sin(h) * 43758.5453123);
}

fn hash22(p: vec2f) -> vec2f {
  return vec2f(hash21(p), hash21(p + vec2f(19.19, 73.17)));
}

fn rotate2(p: vec2f, angle: f32) -> vec2f {
  let s = sin(angle);
  let c = cos(angle);
  return vec2f(p.x * c - p.y * s, p.x * s + p.y * c);
}

fn noise2(p: vec2f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (vec2f(3.0) - 2.0 * f);
  let a = hash21(i);
  let b = hash21(i + vec2f(1.0, 0.0));
  let c = hash21(i + vec2f(0.0, 1.0));
  let d = hash21(i + vec2f(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

fn fbm2(pIn: vec2f, octaves: f32, gain: f32, lacunarity: f32) -> f32 {
  var p = pIn;
  var amp = 0.5;
  var sum = 0.0;
  var norm = 0.0;
  for (var i = 0; i < 8; i = i + 1) {
    if (f32(i) < octaves) {
      sum = sum + noise2(p) * amp;
      norm = norm + amp;
      amp = amp * gain;
      p = p * lacunarity + vec2f(13.17, 9.23);
    }
  }
  return sum / max(norm, 0.0001);
}

fn ridgedFbm2(pIn: vec2f, octaves: f32, gain: f32, lacunarity: f32) -> f32 {
  var p = pIn;
  var amp = 0.5;
  var sum = 0.0;
  var norm = 0.0;
  for (var i = 0; i < 8; i = i + 1) {
    if (f32(i) < octaves) {
      let ridge = 1.0 - abs(noise2(p) * 2.0 - 1.0);
      sum = sum + ridge * ridge * amp;
      norm = norm + amp;
      amp = amp * gain;
      p = p * lacunarity + vec2f(17.11, 5.37);
    }
  }
  return sum / max(norm, 0.0001);
}

fn turbulence2(pIn: vec2f, octaves: f32, gain: f32, lacunarity: f32) -> f32 {
  var p = pIn;
  var amp = 0.5;
  var sum = 0.0;
  var norm = 0.0;
  for (var i = 0; i < 8; i = i + 1) {
    if (f32(i) < octaves) {
      sum = sum + abs(noise2(p) * 2.0 - 1.0) * amp;
      norm = norm + amp;
      amp = amp * gain;
      p = p * lacunarity + vec2f(4.19, 21.71);
    }
  }
  return sum / max(norm, 0.0001);
}

fn voronoi2(p: vec2f, jitter: f32) -> f32 {
  let base = floor(p);
  let f = fract(p);
  var best = 8.0;
  for (var y = -1; y <= 1; y = y + 1) {
    for (var x = -1; x <= 1; x = x + 1) {
      let cell = vec2f(f32(x), f32(y));
      let point = vec2f(hash21(base + cell), hash21(base + cell + vec2f(8.31, 2.17)));
      let diff = cell + point * jitter - f;
      best = min(best, dot(diff, diff));
    }
  }
  return clamp(sqrt(best), 0.0, 1.0);
}

fn safeMod(value: f32, period: f32) -> f32 {
  let p = max(abs(period), 0.0001);
  return value - floor(value / p) * p;
}

fn sdBox2(p: vec2f, b: vec2f) -> f32 {
  let q = abs(p) - b;
  return length(max(q, vec2f(0.0))) + min(max(q.x, q.y), 0.0);
}

fn biasValue(value: f32, bias: f32) -> f32 {
  let b = clamp(bias, 0.001, 0.999);
  let x = clamp(value, 0.0, 1.0);
  return x / ((((1.0 / b) - 2.0) * (1.0 - x)) + 1.0);
}

fn gainValue(value: f32, gain: f32) -> f32 {
  let x = clamp(value, 0.0, 1.0);
  let g = clamp(gain, 0.001, 0.999);
  if (x < 0.5) {
    return biasValue(x * 2.0, g) * 0.5;
  }
  return 1.0 - biasValue(2.0 - x * 2.0, g) * 0.5;
}

fn rgb2hsv(c: vec3f) -> vec3f {
  let K = vec4f(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  let p = select(vec4f(c.bg, K.wz), vec4f(c.gb, K.xy), c.b < c.g);
  let q = select(vec4f(p.xyw, c.r), vec4f(c.r, p.yzx), p.x < c.r);
  let d = q.x - min(q.w, q.y);
  let e = 1.0e-10;
  return vec3f(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}

fn hsv2rgb(c: vec3f) -> vec3f {
  let K = vec4f(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  let p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, vec3f(0.0), vec3f(1.0)), c.y);
}
`;

export function compileGraph(graph) {
  const errors = [];
  const outputNode = findNode(graph, graph.outputNodeId);
  if (!outputNode) {
    return failed("Missing Output node.");
  }
  if (outputNode.type !== "output") {
    return failed("Configured output node is not an Output node.");
  }

  const incoming = new Map();
  for (const current of graph.edges) {
    incoming.set(`${current.to.nodeId}:${current.to.portId}`, current);
  }

  const ordered = [];
  const temp = new Set();
  const visited = new Set();

  const visit = (nodeId) => {
    if (temp.has(nodeId)) {
      errors.push("Graph contains a cycle.");
      return;
    }
    if (visited.has(nodeId)) return;
    const node = findNode(graph, nodeId);
    if (!node) {
      errors.push(`Missing node ${nodeId}.`);
      return;
    }
    const def = getNodeDefinition(node.type);
    if (!def) {
      errors.push(`Unknown node type ${node.type}.`);
      return;
    }
    temp.add(nodeId);
    for (const port of def.inputs) {
      const current = incoming.get(`${node.id}:${port.id}`);
      if (current) visit(current.from.nodeId);
      if (!current && port.required) {
        errors.push(`${def.label} requires ${port.label}.`);
      }
    }
    temp.delete(nodeId);
    visited.add(nodeId);
    ordered.push(node);
  };

  visit(outputNode.id);
  if (errors.length > 0) return failed(errors.join("\n"));

  const paramLayout = [];
  const paramIndex = new Map();
  for (const node of ordered) {
    const def = getNodeDefinition(node.type);
    for (const param of def.params) {
      paramIndex.set(`${node.id}:${param.id}`, paramLayout.length);
      paramLayout.push({ nodeId: node.id, paramId: param.id, type: param.type });
    }
  }

  const variable = (nodeId, portId) => `v_${clean(nodeId)}_${clean(portId)}`;
  const lines = [];
  for (const node of ordered) {
    const def = getNodeDefinition(node.type);
    const out = (portId) => variable(node.id, portId);
    const readScalarInput = (portId, fallback = null) => {
      const port = def.inputs.find((candidate) => candidate.id === portId);
      const current = incoming.get(`${node.id}:${portId}`);
      if (!current) return port?.fallback || fallback || "0.0";
      return variable(current.from.nodeId, current.from.portId);
    };
    const input = (portId) => {
      const group = def.scalarInputs?.[portId];
      if (group) {
        const parts = group.components.map((component) => readScalarInput(component.id, component.fallback));
        return `${group.constructor}(${parts.join(", ")})`;
      }
      return readScalarInput(portId);
    };
    const connectedParamInput = (paramId, suffix = "") => {
      const current = incoming.get(`${node.id}:${paramInputId(paramId, suffix)}`);
      return current ? variable(current.from.nodeId, current.from.portId) : null;
    };
    const param = (paramId, component = "x") => {
      const base = `params[${paramIndex.get(`${node.id}:${paramId}`)}].${component}`;
      const mod = connectedParamInput(paramId);
      return mod ? `(${base} + ${mod})` : base;
    };
    const paramColor = (paramId) => {
      const base = `params[${paramIndex.get(`${node.id}:${paramId}`)}]`;
      const paramDef = def.params.find((candidate) => candidate.id === paramId);
      if (paramDef?.type !== "color") return base;
      const channels = [
        ["x", "R"],
        ["y", "G"],
        ["z", "B"],
        ["w", "A"]
      ].map(([component, suffix]) => {
        const mod = connectedParamInput(paramId, suffix);
        return mod ? `(${base}.${component} + ${mod})` : `${base}.${component}`;
      });
      return `vec4f(${channels.join(", ")})`;
    };
    lines.push(`// ${def.label} (${node.id})`);
    lines.push(def.emit({ node, input, out, param, paramColor }).trim());
    for (const group of Object.values(def.scalarOutputs || {})) {
      for (const component of group.components) {
        lines.push(`let ${variable(node.id, component.id)} = ${variable(node.id, group.id)}.${component.accessor};`);
      }
    }
  }

  const finalExpr = variable(outputNode.id, "color");
  const wgsl = buildShader(lines.join("\n"), finalExpr);
  return { ok: true, wgsl, paramLayout, errors: [] };

  function failed(message) {
    return {
      ok: false,
      wgsl: buildShader("", "vec4f(0.02, 0.03, 0.05, 1.0)"),
      paramLayout: [],
      errors: [message]
    };
  }
}

export function packParams(graph, paramLayout) {
  const floats = new Float32Array(Math.max(4, paramLayout.length * 4));
  for (let i = 0; i < paramLayout.length; i += 1) {
    const entry = paramLayout[i];
    const node = findNode(graph, entry.nodeId);
    const def = node ? NODE_DEFINITIONS[node.type] : null;
    const paramDef = def?.params.find((param) => param.id === entry.paramId);
    const raw = node?.params?.[entry.paramId] ?? paramDef?.default ?? 0;
    const offset = i * 4;
    if (paramDef?.type === "color") {
      const color = parseColor(raw);
      floats[offset] = color[0];
      floats[offset + 1] = color[1];
      floats[offset + 2] = color[2];
      floats[offset + 3] = color[3];
    } else if (paramDef?.type === "toggle") {
      floats[offset] = raw ? 1 : 0;
    } else {
      const numeric = Number(raw) || 0;
      floats[offset] = Number.isFinite(paramDef?.min) && Number.isFinite(paramDef?.max)
        ? clamp(numeric, paramDef.min, paramDef.max)
        : numeric;
    }
  }
  return floats;
}

function parseColor(raw) {
  const value = typeof raw === "string" && /^#[0-9a-f]{6}$/i.test(raw) ? raw : "#ffffff";
  const r = parseInt(value.slice(1, 3), 16) / 255;
  const g = parseInt(value.slice(3, 5), 16) / 255;
  const b = parseInt(value.slice(5, 7), 16) / 255;
  return [r, g, b, 1];
}

function clean(value) {
  return String(value).replace(/[^a-zA-Z0-9_]/g, "_");
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function buildShader(nodeBody, finalExpr) {
  return `
struct Frame {
  resolution: vec2f,
  time: f32,
  timeScale: f32,
  offset: vec2f,
  zoom: f32,
  pad0: f32,
  mouse: vec2f,
  audioLevel: f32,
  beat: f32,
  audioBands: vec4f,
  transition: vec4f,
};

@group(0) @binding(0) var<uniform> frame: Frame;
@group(0) @binding(1) var outputTex: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(2) var<storage, read> params: array<vec4f>;

${WGSL_HELPERS}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let size = textureDimensions(outputTex);
  if (gid.x >= size.x || gid.y >= size.y) {
    return;
  }
  let pixel = vec2f(f32(gid.x), f32(gid.y));
  let uv = pixel / frame.resolution;
  let centered = uv * 2.0 - vec2f(1.0);
  let aspect = frame.resolution.x / max(frame.resolution.y, 1.0);
  let world = vec2f(centered.x * aspect, -centered.y) / max(frame.zoom, 0.0001) + frame.offset;

${indent(nodeBody)}

  let color = clamp(${finalExpr}, vec4f(0.0), vec4f(1.0));
  textureStore(outputTex, vec2i(gid.xy), color);
}
`;
}

function indent(source) {
  return source
    .split("\n")
    .map((line) => (line.trim() ? `  ${line}` : ""))
    .join("\n");
}
