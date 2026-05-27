import {
  buildDifferenceKernel,
  createInitialBzState,
  createInitialColors,
  createInitialField,
  createLowFrequencyNoise,
  hexToRgb01,
  isPowerOfTwo,
} from "./utils.js";
import { sanitizeConfig } from "./presets.js";

const WORKGROUP_SIZE = 256;

const COMMON_WGSL = `
struct Globals {
  size: u32,
  cellCount: u32,
  scaleCount: u32,
  colorEnabled: u32,
  noiseStrength: f32,
  step: u32,
  pad1: f32,
  pad2: f32,
}

struct FftParams {
  size: u32,
  stage: u32,
  inverse: u32,
  horizontal: u32,
  logSize: u32,
  pad0: u32,
  normalize: f32,
  pad1: u32,
}

struct ScaleIndex {
  value: u32,
  pad0: u32,
  pad1: u32,
  pad2: u32,
}

struct ScaleParam {
  amount: f32,
  weight: f32,
  symmetry: f32,
  radius: f32,
  ratio: f32,
  pad0: f32,
  pad1: f32,
  pad2: f32,
  color: vec4<f32>,
}

struct ReduceParams {
  inputLength: u32,
  outputLength: u32,
  pad0: u32,
  pad1: u32,
}

struct ViewParams {
  zoom: f32,
  panX: f32,
  panY: f32,
  outputWidth: f32,
  outputHeight: f32,
  pad0: f32,
  pad1: f32,
  pad2: f32,
}

fn cmul(a: vec2<f32>, b: vec2<f32>) -> vec2<f32> {
  return vec2<f32>(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x);
}

fn wrapCoord(value: i32, size: i32) -> u32 {
  let m = value % size;
  return u32(select(m + size, m, m >= 0));
}
`;

const PREPARE_WGSL = `${COMMON_WGSL}
@group(0) @binding(0) var<uniform> globals: Globals;
@group(0) @binding(1) var<storage, read> field: array<f32>;
@group(0) @binding(2) var<storage, read_write> outputData: array<vec2<f32>>;

@compute @workgroup_size(${WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let id = gid.x;
  if (id >= globals.cellCount) {
    return;
  }
  outputData[id] = vec2<f32>(field[id], 0.0);
}
`;

const BIT_REVERSE_WGSL = `${COMMON_WGSL}
@group(0) @binding(0) var<uniform> params: FftParams;
@group(0) @binding(1) var<storage, read> inputData: array<vec2<f32>>;
@group(0) @binding(2) var<storage, read_write> outputData: array<vec2<f32>>;

fn reverseBits(value: u32, bits: u32) -> u32 {
  var x = value;
  var out = 0u;
  for (var i = 0u; i < bits; i = i + 1u) {
    out = (out << 1u) | (x & 1u);
    x = x >> 1u;
  }
  return out;
}

@compute @workgroup_size(${WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let id = gid.x;
  let total = params.size * params.size;
  if (id >= total) {
    return;
  }

  let x = id % params.size;
  let y = id / params.size;
  var outIndex: u32;
  if (params.horizontal == 1u) {
    outIndex = y * params.size + reverseBits(x, params.logSize);
  } else {
    outIndex = reverseBits(y, params.logSize) * params.size + x;
  }
  outputData[outIndex] = inputData[id];
}
`;

const FFT_WGSL = `${COMMON_WGSL}
@group(0) @binding(0) var<uniform> params: FftParams;
@group(0) @binding(1) var<storage, read> inputData: array<vec2<f32>>;
@group(0) @binding(2) var<storage, read_write> outputData: array<vec2<f32>>;

@compute @workgroup_size(${WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let pairId = gid.x;
  let totalPairs = (params.size * params.size) / 2u;
  if (pairId >= totalPairs) {
    return;
  }

  let half = 1u << params.stage;
  let span = half << 1u;
  var indexA: u32;
  var indexB: u32;
  var localJ: u32;

  if (params.horizontal == 1u) {
    let row = pairId / (params.size / 2u);
    let pairInRow = pairId % (params.size / 2u);
    let block = pairInRow / half;
    localJ = pairInRow % half;
    let xA = block * span + localJ;
    indexA = row * params.size + xA;
    indexB = indexA + half;
  } else {
    let col = pairId % params.size;
    let pairInCol = pairId / params.size;
    let block = pairInCol / half;
    localJ = pairInCol % half;
    let yA = block * span + localJ;
    indexA = yA * params.size + col;
    indexB = indexA + half * params.size;
  }

  let angleSign = select(-1.0, 1.0, params.inverse == 1u);
  let angle = angleSign * 6.283185307179586 * f32(localJ) / f32(span);
  let twiddle = vec2<f32>(cos(angle), sin(angle));
  let a = inputData[indexA];
  let b = cmul(inputData[indexB], twiddle);
  outputData[indexA] = (a + b) * params.normalize;
  outputData[indexB] = (a - b) * params.normalize;
}
`;

const MULTIPLY_WGSL = `${COMMON_WGSL}
@group(0) @binding(0) var<uniform> globals: Globals;
@group(0) @binding(1) var<uniform> scaleIndex: ScaleIndex;
@group(0) @binding(2) var<storage, read> spectrum: array<vec2<f32>>;
@group(0) @binding(3) var<storage, read> kernels: array<vec2<f32>>;
@group(0) @binding(4) var<storage, read_write> outputData: array<vec2<f32>>;

@compute @workgroup_size(${WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let id = gid.x;
  if (id >= globals.cellCount) {
    return;
  }
  let kernelId = scaleIndex.value * globals.cellCount + id;
  outputData[id] = cmul(spectrum[id], kernels[kernelId]);
}
`;

const DIFF_WGSL = `${COMMON_WGSL}
@group(0) @binding(0) var<uniform> globals: Globals;
@group(0) @binding(1) var<storage, read> scales: array<ScaleParam>;
@group(0) @binding(2) var<uniform> scaleIndex: ScaleIndex;
@group(0) @binding(3) var<storage, read> convolution: array<vec2<f32>>;
@group(0) @binding(4) var<storage, read_write> diffs: array<f32>;

fn sampleConvolution(x: u32, y: u32) -> f32 {
  return convolution[y * globals.size + x].x;
}

@compute @workgroup_size(${WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let id = gid.x;
  if (id >= globals.cellCount) {
    return;
  }

  let x = id % globals.size;
  let y = id / globals.size;
  let scale = scales[scaleIndex.value];
  let symmetry = u32(clamp(scale.symmetry, 1.0, 16.0));
  var value = sampleConvolution(x, y);

  if (symmetry > 1u) {
    let center = f32(globals.size) * 0.5;
    let dx = f32(x) - center;
    let dy = f32(y) - center;
    var total = 0.0;

    for (var k = 0u; k < 16u; k = k + 1u) {
      if (k >= symmetry) {
        break;
      }
      let angle = 6.283185307179586 * f32(k) / f32(symmetry);
      let rx = dx * cos(angle) - dy * sin(angle);
      let ry = dx * sin(angle) + dy * cos(angle);
      let sx = wrapCoord(i32(round(rx + center)), i32(globals.size));
      let sy = wrapCoord(i32(round(ry + center)), i32(globals.size));
      total = total + sampleConvolution(sx, sy);
    }
    value = total / f32(symmetry);
  }

  diffs[scaleIndex.value * globals.cellCount + id] = value;
}
`;

const SELECT_WGSL = `${COMMON_WGSL}
@group(0) @binding(0) var<uniform> globals: Globals;
@group(0) @binding(1) var<storage, read> scales: array<ScaleParam>;
@group(0) @binding(2) var<storage, read> field: array<f32>;
@group(0) @binding(3) var<storage, read_write> nextField: array<f32>;
@group(0) @binding(4) var<storage, read> diffs: array<f32>;
@group(0) @binding(5) var<storage, read> colorIn: array<vec4<f32>>;
@group(0) @binding(6) var<storage, read_write> colorOut: array<vec4<f32>>;
@group(0) @binding(7) var<storage, read> lowNoise: array<f32>;

fn scaleNoiseBias(scale: u32, noiseValue: f32) -> f32 {
  let phase = sin(f32(scale + 1u) * 2.399963229728653);
  return clamp(1.0 + noiseValue * phase, 0.25, 2.0);
}

@compute @workgroup_size(${WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let id = gid.x;
  if (id >= globals.cellCount) {
    return;
  }

  let noiseValue = lowNoise[id] * globals.noiseStrength;
  var bestScale = 0u;
  var bestDiff = diffs[id];
  var bestScore = abs(bestDiff) / max(scales[0].weight * scaleNoiseBias(0u, noiseValue), 0.0001);

  for (var scale = 1u; scale < globals.scaleCount; scale = scale + 1u) {
    let diff = diffs[scale * globals.cellCount + id];
    let score = abs(diff) / max(scales[scale].weight * scaleNoiseBias(scale, noiseValue), 0.0001);
    if (score < bestScore) {
      bestScore = score;
      bestDiff = diff;
      bestScale = scale;
    }
  }

  let amount = scales[bestScale].amount;
  let amountBias = clamp(1.0 + noiseValue * 0.45, 0.5, 1.5);
  let delta = select(-amount, amount, bestDiff > 0.0) * amountBias;
  nextField[id] = field[id] + delta;

  let previous = colorIn[id];
  let targetColor = scales[bestScale].color;
  colorOut[id] = select(previous, previous * 0.955 + targetColor * 0.045, globals.colorEnabled == 1u);
}
`;

const REPROJECT_TURING_WGSL = `${COMMON_WGSL}
@group(0) @binding(0) var<uniform> globals: Globals;
@group(0) @binding(1) var<uniform> view: ViewParams;
@group(0) @binding(2) var<storage, read> fieldIn: array<f32>;
@group(0) @binding(3) var<storage, read_write> fieldOut: array<f32>;
@group(0) @binding(4) var<storage, read> colorIn: array<vec4<f32>>;
@group(0) @binding(5) var<storage, read_write> colorOut: array<vec4<f32>>;

fn sourcePosition(position: vec2<f32>) -> vec2<f32> {
  let center = vec2<f32>(f32(globals.size - 1u) * 0.5);
  return (position - center) / max(view.zoom, 0.0001) + center - vec2<f32>(view.panX, view.panY);
}

fn mirrorCoord(value: i32, size: i32) -> u32 {
  let period = max(size * 2 - 2, 1);
  let raw = value % period;
  let mirrored = select(raw + period, raw, raw >= 0);
  return u32(select(period - mirrored, mirrored, mirrored < size));
}

fn sampleFieldAt(position: vec2<f32>) -> f32 {
  let base = floor(position);
  let frac = position - base;
  let x0 = mirrorCoord(i32(base.x), i32(globals.size));
  let y0 = mirrorCoord(i32(base.y), i32(globals.size));
  let x1 = mirrorCoord(i32(base.x) + 1, i32(globals.size));
  let y1 = mirrorCoord(i32(base.y) + 1, i32(globals.size));
  let a = fieldIn[y0 * globals.size + x0];
  let b = fieldIn[y0 * globals.size + x1];
  let c = fieldIn[y1 * globals.size + x0];
  let d = fieldIn[y1 * globals.size + x1];
  return mix(mix(a, b, frac.x), mix(c, d, frac.x), frac.y);
}

fn sampleColorAt(position: vec2<f32>) -> vec4<f32> {
  let base = floor(position);
  let frac = position - base;
  let x0 = mirrorCoord(i32(base.x), i32(globals.size));
  let y0 = mirrorCoord(i32(base.y), i32(globals.size));
  let x1 = mirrorCoord(i32(base.x) + 1, i32(globals.size));
  let y1 = mirrorCoord(i32(base.y) + 1, i32(globals.size));
  let a = colorIn[y0 * globals.size + x0];
  let b = colorIn[y0 * globals.size + x1];
  let c = colorIn[y1 * globals.size + x0];
  let d = colorIn[y1 * globals.size + x1];
  return mix(mix(a, b, frac.x), mix(c, d, frac.x), frac.y);
}

@compute @workgroup_size(${WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let id = gid.x;
  if (id >= globals.cellCount) {
    return;
  }
  let x = id % globals.size;
  let y = id / globals.size;
  let source = sourcePosition(vec2<f32>(f32(x), f32(y)));
  fieldOut[id] = sampleFieldAt(source);
  colorOut[id] = sampleColorAt(source);
}
`;

const BZ_STEP_WGSL = `${COMMON_WGSL}
@group(0) @binding(0) var<uniform> globals: Globals;
@group(0) @binding(1) var<storage, read> scales: array<ScaleParam>;
@group(0) @binding(2) var<storage, read> currentState: array<vec4<f32>>;
@group(0) @binding(3) var<storage, read_write> nextState: array<vec4<f32>>;
@group(0) @binding(4) var<storage, read> lowNoise: array<f32>;

fn hash01(seed: u32) -> f32 {
  var x = seed;
  x = (x ^ 61u) ^ (x >> 16u);
  x = x * 9u;
  x = x ^ (x >> 4u);
  x = x * 0x27d4eb2du;
  x = x ^ (x >> 15u);
  return f32(x & 0x00ffffffu) / 16777216.0;
}

fn mirrorCoord(value: i32, size: i32) -> u32 {
  let period = max(size * 2 - 2, 1);
  let raw = value % period;
  let mirrored = select(raw + period, raw, raw >= 0);
  return u32(select(period - mirrored, mirrored, mirrored < size));
}

fn sampleState(pos: vec2<f32>) -> vec4<f32> {
  let sx = mirrorCoord(i32(round(pos.x)), i32(globals.size));
  let sy = mirrorCoord(i32(round(pos.y)), i32(globals.size));
  return currentState[sy * globals.size + sx];
}

fn activeValue(state: vec4<f32>) -> f32 {
  let phase = state.x;
  return select(0.0, 1.0, phase > 0.02 && phase < 0.68);
}

fn ringActivity(pos: vec2<f32>, radius: f32) -> f32 {
  let r = max(radius, 1.0);
  let d = r * 0.70710678118;
  var sum = 0.0;
  sum = sum + activeValue(sampleState(pos + vec2<f32>(r, 0.0)));
  sum = sum + activeValue(sampleState(pos + vec2<f32>(-r, 0.0)));
  sum = sum + activeValue(sampleState(pos + vec2<f32>(0.0, r)));
  sum = sum + activeValue(sampleState(pos + vec2<f32>(0.0, -r)));
  sum = sum + activeValue(sampleState(pos + vec2<f32>(d, d)));
  sum = sum + activeValue(sampleState(pos + vec2<f32>(-d, d)));
  sum = sum + activeValue(sampleState(pos + vec2<f32>(d, -d)));
  sum = sum + activeValue(sampleState(pos + vec2<f32>(-d, -d)));
  return sum * 0.125;
}

@compute @workgroup_size(${WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let id = gid.x;
  if (id >= globals.cellCount) {
    return;
  }

  let x = id % globals.size;
  let y = id / globals.size;
  let pos = vec2<f32>(f32(x), f32(y));
  let center = vec2<f32>(f32(globals.size) * 0.5);
  let noiseValue = lowNoise[id] * globals.noiseStrength;
  let edgeDistance = min(min(pos.x, pos.y), min(f32(globals.size - 1u) - pos.x, f32(globals.size - 1u) - pos.y));
  let edgeFade = smoothstep(12.0, 72.0, edgeDistance);
  let angle = noiseValue * 5.1 + f32(globals.step) * 0.012;
  let drift = vec2<f32>(cos(angle), sin(angle)) * noiseValue * 0.42 * edgeFade;
  let inflation = (0.0014 + max(noiseValue, 0.0) * 0.0011) * edgeFade;
  let sourcePos = center + (pos - center) * (1.0 - inflation) + drift;
  let source = sampleState(sourcePos);

  var signal = 0.0;
  var propagation = 0.0;
  var bestScale = 0u;
  for (var scale = 0u; scale < globals.scaleCount; scale = scale + 1u) {
    let scaleParam = scales[scale];
    let inner = ringActivity(sourcePos, scaleParam.radius);
    let outer = ringActivity(sourcePos, scaleParam.radius * max(scaleParam.ratio, 1.01));
    let localSignal = (inner * 0.82 + outer * 0.28) * scaleParam.weight;
    if (localSignal > signal) {
      signal = localSignal;
      bestScale = scale;
    }
    propagation = max(propagation, abs(scaleParam.amount) * (0.65 + localSignal));
  }

  var phase = source.x;
  var refractory = source.y;
  var density = source.z;
  let layerDenominator = max(f32(globals.scaleCount) - 1.0, 1.0);
  let targetLayer = f32(bestScale) / layerDenominator;
  var layer = mix(source.w, targetLayer, clamp(signal * 0.18 + 0.018, 0.018, 0.22));
  let threshold = clamp(0.22 + refractory * 0.24 - noiseValue * 0.11 - density * 0.04, 0.08, 0.58);
  let sparkRate = 0.000018 + max(noiseValue, 0.0) * 0.000055;
  let spark = hash01(id * 747796405u + globals.step * 2891336453u + 23u) < sparkRate;

  if (phase <= 0.001) {
    if (signal > threshold || spark) {
      phase = 0.035 + clamp(signal - threshold, 0.0, 0.25);
    } else {
      phase = 0.0;
    }
  } else {
    phase = phase + 0.018 + propagation * 0.42 + signal * 0.014 + noiseValue * 0.0025;
    if (phase >= 1.0) {
      phase = 0.0;
      refractory = 1.0;
    }
  }

  let wave = select(0.0, 1.0, phase > 0.001);
  refractory = clamp(refractory + wave * 0.018 - 0.012 - density * 0.002, 0.0, 1.0);
  density = clamp(density + (signal - threshold) * 0.012 - wave * 0.0025 + noiseValue * 0.0009, 0.0, 1.0);
  nextState[id] = vec4<f32>(phase, refractory, density, layer);
}
`;

const REPROJECT_BZ_WGSL = `${COMMON_WGSL}
@group(0) @binding(0) var<uniform> globals: Globals;
@group(0) @binding(1) var<uniform> view: ViewParams;
@group(0) @binding(2) var<storage, read> stateIn: array<vec4<f32>>;
@group(0) @binding(3) var<storage, read_write> stateOut: array<vec4<f32>>;

fn sourcePosition(position: vec2<f32>) -> vec2<f32> {
  let center = vec2<f32>(f32(globals.size - 1u) * 0.5);
  return (position - center) / max(view.zoom, 0.0001) + center - vec2<f32>(view.panX, view.panY);
}

fn clampCoord(value: i32) -> u32 {
  return u32(clamp(value, 0, i32(globals.size) - 1));
}

fn sampleStateAt(position: vec2<f32>) -> vec4<f32> {
  let base = floor(position);
  let frac = clamp(position - base, vec2<f32>(0.0), vec2<f32>(1.0));
  let x0 = clampCoord(i32(base.x));
  let y0 = clampCoord(i32(base.y));
  let x1 = clampCoord(i32(base.x) + 1);
  let y1 = clampCoord(i32(base.y) + 1);
  let a = stateIn[y0 * globals.size + x0];
  let b = stateIn[y0 * globals.size + x1];
  let c = stateIn[y1 * globals.size + x0];
  let d = stateIn[y1 * globals.size + x1];
  return mix(mix(a, b, frac.x), mix(c, d, frac.x), frac.y);
}

@compute @workgroup_size(${WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let id = gid.x;
  if (id >= globals.cellCount) {
    return;
  }
  let x = id % globals.size;
  let y = id / globals.size;
  stateOut[id] = sampleStateAt(sourcePosition(vec2<f32>(f32(x), f32(y))));
}
`;

const REDUCE_FIELD_WGSL = `${COMMON_WGSL}
@group(0) @binding(0) var<uniform> params: ReduceParams;
@group(0) @binding(1) var<storage, read> field: array<f32>;
@group(0) @binding(2) var<storage, read_write> outMinMax: array<vec2<f32>>;

@compute @workgroup_size(${WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let outId = gid.x;
  if (outId >= params.outputLength) {
    return;
  }
  let start = outId * ${WORKGROUP_SIZE}u;
  let end = min(start + ${WORKGROUP_SIZE}u, params.inputLength);
  var mn = 1.0e30;
  var mx = -1.0e30;
  for (var i = start; i < end; i = i + 1u) {
    let value = field[i];
    mn = min(mn, value);
    mx = max(mx, value);
  }
  outMinMax[outId] = vec2<f32>(mn, mx);
}
`;

const REDUCE_MINMAX_WGSL = `${COMMON_WGSL}
@group(0) @binding(0) var<uniform> params: ReduceParams;
@group(0) @binding(1) var<storage, read> inMinMax: array<vec2<f32>>;
@group(0) @binding(2) var<storage, read_write> outMinMax: array<vec2<f32>>;

@compute @workgroup_size(${WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let outId = gid.x;
  if (outId >= params.outputLength) {
    return;
  }
  let start = outId * ${WORKGROUP_SIZE}u;
  let end = min(start + ${WORKGROUP_SIZE}u, params.inputLength);
  var mn = 1.0e30;
  var mx = -1.0e30;
  for (var i = start; i < end; i = i + 1u) {
    let value = inMinMax[i];
    mn = min(mn, value.x);
    mx = max(mx, value.y);
  }
  outMinMax[outId] = vec2<f32>(mn, mx);
}
`;

const NORMALIZE_WGSL = `${COMMON_WGSL}
@group(0) @binding(0) var<uniform> globals: Globals;
@group(0) @binding(1) var<storage, read> nextField: array<f32>;
@group(0) @binding(2) var<storage, read> minMax: array<vec2<f32>>;
@group(0) @binding(3) var<storage, read_write> field: array<f32>;

@compute @workgroup_size(${WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let id = gid.x;
  if (id >= globals.cellCount) {
    return;
  }
  let mn = minMax[0].x;
  let mx = minMax[0].y;
  let range = max(mx - mn, 0.000001);
  field[id] = ((nextField[id] - mn) / range) * 2.0 - 1.0;
}
`;

const RENDER_WGSL = `${COMMON_WGSL}
@group(0) @binding(0) var<uniform> globals: Globals;
@group(0) @binding(1) var<storage, read> field: array<f32>;
@group(0) @binding(2) var<storage, read> colors: array<vec4<f32>>;
@group(0) @binding(3) var<uniform> view: ViewParams;

struct VertexOut {
  @builtin(position) position: vec4<f32>,
}

@vertex
fn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> VertexOut {
  var positions = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>(3.0, -1.0),
    vec2<f32>(-1.0, 3.0)
  );
  var out: VertexOut;
  out.position = vec4<f32>(positions[vertexIndex], 0.0, 1.0);
  return out;
}

fn sourcePosition(position: vec2<f32>) -> vec2<f32> {
  let outputCenter = vec2<f32>(view.outputWidth - 1.0, view.outputHeight - 1.0) * 0.5;
  let sourceCenter = vec2<f32>(f32(globals.size - 1u) * 0.5 - view.panX, f32(globals.size - 1u) * 0.5 - view.panY);
  let sourcePerOutputPixel = f32(globals.size) / min(view.outputWidth, view.outputHeight) / max(view.zoom, 0.0001);
  return (position - outputCenter) * sourcePerOutputPixel + sourceCenter;
}

fn sampleFieldAt(position: vec2<f32>) -> f32 {
  let base = floor(position);
  let frac = position - base;
  let x0 = wrapCoord(i32(base.x), i32(globals.size));
  let y0 = wrapCoord(i32(base.y), i32(globals.size));
  let x1 = wrapCoord(i32(base.x) + 1, i32(globals.size));
  let y1 = wrapCoord(i32(base.y) + 1, i32(globals.size));
  let a = field[y0 * globals.size + x0];
  let b = field[y0 * globals.size + x1];
  let c = field[y1 * globals.size + x0];
  let d = field[y1 * globals.size + x1];
  return mix(mix(a, b, frac.x), mix(c, d, frac.x), frac.y);
}

fn sampleColorAt(position: vec2<f32>) -> vec4<f32> {
  let base = floor(position);
  let frac = position - base;
  let x0 = wrapCoord(i32(base.x), i32(globals.size));
  let y0 = wrapCoord(i32(base.y), i32(globals.size));
  let x1 = wrapCoord(i32(base.x) + 1, i32(globals.size));
  let y1 = wrapCoord(i32(base.y) + 1, i32(globals.size));
  let a = colors[y0 * globals.size + x0];
  let b = colors[y0 * globals.size + x1];
  let c = colors[y1 * globals.size + x0];
  let d = colors[y1 * globals.size + x1];
  return mix(mix(a, b, frac.x), mix(c, d, frac.x), frac.y);
}

@fragment
fn fragmentMain(@builtin(position) position: vec4<f32>) -> @location(0) vec4<f32> {
  let source = sourcePosition(position.xy);
  let intensity = clamp(sampleFieldAt(source) * 0.5 + 0.5, 0.0, 1.0);
  var rgb = vec3<f32>(intensity);
  if (globals.colorEnabled == 1u) {
    let base = max(sampleColorAt(source).rgb, vec3<f32>(0.02));
    rgb = base * (0.18 + 1.15 * intensity);
  }
  rgb = pow(clamp(rgb, vec3<f32>(0.0), vec3<f32>(1.0)), vec3<f32>(0.92));
  return vec4<f32>(rgb, 1.0);
}
`;

const BZ_RENDER_WGSL = `${COMMON_WGSL}
@group(0) @binding(0) var<uniform> globals: Globals;
@group(0) @binding(1) var<storage, read> bzState: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read> scales: array<ScaleParam>;
@group(0) @binding(3) var<storage, read> lowNoise: array<f32>;
@group(0) @binding(4) var<uniform> view: ViewParams;

struct VertexOut {
  @builtin(position) position: vec4<f32>,
}

@vertex
fn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> VertexOut {
  var positions = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>(3.0, -1.0),
    vec2<f32>(-1.0, 3.0)
  );
  var out: VertexOut;
  out.position = vec4<f32>(positions[vertexIndex], 0.0, 1.0);
  return out;
}

fn sourcePosition(position: vec2<f32>) -> vec2<f32> {
  let outputCenter = vec2<f32>(view.outputWidth - 1.0, view.outputHeight - 1.0) * 0.5;
  let sourceCenter = vec2<f32>(f32(globals.size - 1u) * 0.5 - view.panX, f32(globals.size - 1u) * 0.5 - view.panY);
  let sourcePerOutputPixel = f32(globals.size) / min(view.outputWidth, view.outputHeight) / max(view.zoom, 0.0001);
  return (position - outputCenter) * sourcePerOutputPixel + sourceCenter;
}

fn clampCoord(value: i32) -> u32 {
  return u32(clamp(value, 0, i32(globals.size) - 1));
}

fn sampleBzAt(position: vec2<f32>) -> vec4<f32> {
  let base = floor(position);
  let frac = clamp(position - base, vec2<f32>(0.0), vec2<f32>(1.0));
  let x0 = clampCoord(i32(base.x));
  let y0 = clampCoord(i32(base.y));
  let x1 = clampCoord(i32(base.x) + 1);
  let y1 = clampCoord(i32(base.y) + 1);
  let a = bzState[y0 * globals.size + x0];
  let b = bzState[y0 * globals.size + x1];
  let c = bzState[y1 * globals.size + x0];
  let d = bzState[y1 * globals.size + x1];
  return mix(mix(a, b, frac.x), mix(c, d, frac.x), frac.y);
}

fn sampleNoiseAt(position: vec2<f32>) -> f32 {
  let base = floor(position);
  let frac = clamp(position - base, vec2<f32>(0.0), vec2<f32>(1.0));
  let x0 = clampCoord(i32(base.x));
  let y0 = clampCoord(i32(base.y));
  let x1 = clampCoord(i32(base.x) + 1);
  let y1 = clampCoord(i32(base.y) + 1);
  let a = lowNoise[y0 * globals.size + x0];
  let b = lowNoise[y0 * globals.size + x1];
  let c = lowNoise[y1 * globals.size + x0];
  let d = lowNoise[y1 * globals.size + x1];
  return mix(mix(a, b, frac.x), mix(c, d, frac.x), frac.y);
}

fn paletteColor(layer: f32) -> vec3<f32> {
  let last = max(globals.scaleCount - 1u, 1u);
  let scaled = clamp(layer, 0.0, 1.0) * f32(last);
  let i0 = min(u32(floor(scaled)), globals.scaleCount - 1u);
  let i1 = min(i0 + 1u, globals.scaleCount - 1u);
  return mix(scales[i0].color.rgb, scales[i1].color.rgb, fract(scaled));
}

@fragment
fn fragmentMain(@builtin(position) position: vec4<f32>) -> @location(0) vec4<f32> {
  let source = sourcePosition(position.xy);
  let state = sampleBzAt(source);
  let noiseValue = sampleNoiseAt(source);
  let phase = state.x;
  let refractory = state.y;
  let density = state.z;
  let layerColor = paletteColor(state.w);
  let waveFront = exp(-pow((phase - 0.22) * 7.5, 2.0)) * select(0.0, 1.0, phase > 0.001);
  let lateWave = exp(-pow((phase - 0.68) * 5.0, 2.0)) * select(0.0, 1.0, phase > 0.001);
  let membrane = smoothstep(0.38, 0.7, density) * (1.0 - smoothstep(0.72, 0.98, density));
  let warm = vec3<f32>(1.0, 0.78, 0.22);
  let cool = vec3<f32>(0.15, 0.78, 1.0);
  let magenta = vec3<f32>(1.0, 0.16, 0.62);
  var rgb = mix(vec3<f32>(0.035, 0.032, 0.030), layerColor * (0.36 + density * 1.08), 0.88);
  rgb = mix(rgb, rgb.bgr * vec3<f32>(1.15, 0.92, 1.2), clamp(noiseValue * 0.35 + 0.35, 0.0, 0.65));
  rgb = rgb + membrane * (layerColor * 0.74 + warm * 0.24);
  rgb = rgb + waveFront * mix(warm, magenta, clamp(state.w, 0.0, 1.0)) * 1.25;
  rgb = rgb + lateWave * cool * 0.95;
  rgb = rgb + refractory * mix(vec3<f32>(0.16, 0.04, 0.10), layerColor * 0.46, 0.35);
  if (globals.colorEnabled != 1u) {
    let luma = dot(rgb, vec3<f32>(0.299, 0.587, 0.114));
    rgb = vec3<f32>(luma);
  }
  return vec4<f32>(pow(clamp(rgb, vec3<f32>(0.0), vec3<f32>(1.0)), vec3<f32>(0.86)), 1.0);
}
`;

function createBuffer(device, label, size, usage) {
  return device.createBuffer({ label, size: Math.max(16, size), usage });
}

function writeU32Uniform(device, values) {
  const buffer = createBuffer(device, `u32 uniform ${values[0] ?? 0}`, 16, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
  const data = new Uint32Array(4);
  data.set(values.slice(0, 4));
  device.queue.writeBuffer(buffer, 0, data);
  return buffer;
}

function fftParamData(size, stage, inverse, horizontal, logSize, normalize) {
  const data = new ArrayBuffer(32);
  const view = new DataView(data);
  view.setUint32(0, size, true);
  view.setUint32(4, stage, true);
  view.setUint32(8, inverse ? 1 : 0, true);
  view.setUint32(12, horizontal ? 1 : 0, true);
  view.setUint32(16, logSize, true);
  view.setUint32(20, 0, true);
  view.setFloat32(24, normalize, true);
  view.setUint32(28, 0, true);
  return data;
}

function reduceParamData(inputLength, outputLength) {
  const data = new Uint32Array(4);
  data[0] = inputLength;
  data[1] = outputLength;
  return data;
}

export class TuringEngine {
  static async create(canvas) {
    if (!navigator.gpu) {
      throw new Error("WebGPU is not available.");
    }
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) {
      throw new Error("No WebGPU adapter was found.");
    }
    const device = await adapter.requestDevice();
    const context = canvas.getContext("webgpu");
    const format = navigator.gpu.getPreferredCanvasFormat();
    const engine = new TuringEngine(canvas, device, context, format);
    engine.createPipelines();
    return engine;
  }

  constructor(canvas, device, context, format) {
    this.canvas = canvas;
    this.device = device;
    this.context = context;
    this.format = format;
    this.config = null;
    this.size = 0;
    this.cellCount = 0;
    this.logSize = 0;
    this.stepCount = 0;
    this.bindGroupCache = new Map();
    this.bufferIds = new WeakMap();
    this.nextBufferId = 1;
    this.view = { zoom: 1, panX: 0, panY: 0 };
    this.hasViewBackup = false;
    this.fftParamBuffers = new Map();
    this.reduceParamBuffers = [];
    this.scaleIndexBuffers = [];
  }

  createPipelines() {
    const device = this.device;
    const compute = (label, code) => device.createComputePipeline({
      label,
      layout: "auto",
      compute: { module: device.createShaderModule({ label, code }), entryPoint: "main" },
    });

    this.preparePipeline = compute("prepare complex", PREPARE_WGSL);
    this.bitReversePipeline = compute("bit reverse", BIT_REVERSE_WGSL);
    this.fftPipeline = compute("fft pass", FFT_WGSL);
    this.multiplyPipeline = compute("multiply kernel", MULTIPLY_WGSL);
    this.diffPipeline = compute("write diff", DIFF_WGSL);
    this.selectPipeline = compute("select scale", SELECT_WGSL);
    this.reprojectTuringPipeline = compute("reproject turing", REPROJECT_TURING_WGSL);
    this.bzStepPipeline = compute("bz cellularity step", BZ_STEP_WGSL);
    this.reprojectBzPipeline = compute("reproject bz", REPROJECT_BZ_WGSL);
    this.reduceFieldPipeline = compute("reduce field", REDUCE_FIELD_WGSL);
    this.reduceMinMaxPipeline = compute("reduce minmax", REDUCE_MINMAX_WGSL);
    this.normalizePipeline = compute("normalize", NORMALIZE_WGSL);

    this.renderPipeline = device.createRenderPipeline({
      label: "render pattern",
      layout: "auto",
      vertex: {
        module: device.createShaderModule({ label: "render shader", code: RENDER_WGSL }),
        entryPoint: "vertexMain",
      },
      fragment: {
        module: device.createShaderModule({ label: "render shader", code: RENDER_WGSL }),
        entryPoint: "fragmentMain",
        targets: [{ format: this.format }],
      },
      primitive: { topology: "triangle-list" },
    });

    this.bzRenderPipeline = device.createRenderPipeline({
      label: "render bz cellularity",
      layout: "auto",
      vertex: {
        module: device.createShaderModule({ label: "bz render shader", code: BZ_RENDER_WGSL }),
        entryPoint: "vertexMain",
      },
      fragment: {
        module: device.createShaderModule({ label: "bz render shader", code: BZ_RENDER_WGSL }),
        entryPoint: "fragmentMain",
        targets: [{ format: this.format }],
      },
      primitive: { topology: "triangle-list" },
    });
  }

  async configure(inputConfig, options = {}) {
    const config = sanitizeConfig(inputConfig);
    if (!isPowerOfTwo(config.resolution)) {
      throw new Error("Resolution must be a power of two.");
    }

    const previousConfig = this.config;
    const sizeChanged = config.resolution !== this.size;
    const scaleCountChanged = !previousConfig || config.scales.length !== previousConfig.scales.length;
    const modeChanged = !previousConfig || config.mode !== previousConfig.mode;
    this.config = config;

    if (sizeChanged || scaleCountChanged) {
      this.createBuffers(config.resolution, config.scales.length);
    }

    this.writeGlobals();
    this.writeNoiseField();
    this.writeScaleParams(config.scales);
    if (config.mode === "turing") {
      await this.rebuildKernelSpectra(config.scales);
    }

    if (options.resetField || sizeChanged || modeChanged || !this.initialized) {
      this.resetField(config.seed);
      this.initialized = true;
    }

    this.render();
  }

  createBuffers(size, scaleCount) {
    this.size = size;
    this.cellCount = size * size;
    this.logSize = Math.log2(size);
    this.resizePresentation();
    this.context.configure({
      device: this.device,
      format: this.format,
      alphaMode: "opaque",
    });

    const device = this.device;
    const scalarBytes = this.cellCount * 4;
    const complexBytes = this.cellCount * 8;
    const colorBytes = this.cellCount * 16;
    this.scalarBytes = scalarBytes;
    this.colorBytes = colorBytes;
    const scaleBytes = Math.max(1, scaleCount) * 48;
    const kernelBytes = Math.max(1, scaleCount) * complexBytes;
    const diffBytes = Math.max(1, scaleCount) * scalarBytes;
    const maxStorage = device.limits.maxStorageBufferBindingSize;

    if (kernelBytes > maxStorage || diffBytes > maxStorage) {
      throw new Error("This resolution and scale count exceed the current WebGPU storage buffer limit.");
    }

    this.fieldBuffer = createBuffer(device, "field", scalarBytes, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC);
    this.nextFieldBuffer = createBuffer(device, "next field", scalarBytes, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC);
    this.complexA = createBuffer(device, "complex A", complexBytes, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC);
    this.complexB = createBuffer(device, "complex B", complexBytes, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC);
    this.convolutionA = createBuffer(device, "convolution A", complexBytes, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC);
    this.convolutionB = createBuffer(device, "convolution B", complexBytes, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC);
    this.kernelPrepA = createBuffer(device, "kernel prep A", complexBytes, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC);
    this.kernelPrepB = createBuffer(device, "kernel prep B", complexBytes, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC);
    this.kernelSpectraBuffer = createBuffer(device, "kernel spectra", kernelBytes, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC);
    this.diffBuffer = createBuffer(device, "diffs", diffBytes, GPUBufferUsage.STORAGE);
    this.colorA = createBuffer(device, "color A", colorBytes, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC);
    this.colorB = createBuffer(device, "color B", colorBytes, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC);
    this.bzA = createBuffer(device, "bz state A", colorBytes, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC);
    this.bzB = createBuffer(device, "bz state B", colorBytes, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC);
    this.fieldViewBackup = createBuffer(device, "field view backup", scalarBytes, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC);
    this.colorViewBackup = createBuffer(device, "color view backup", colorBytes, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC);
    this.bzViewBackup = createBuffer(device, "bz view backup", colorBytes, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC);
    this.scaleParamBuffer = createBuffer(device, "scale params", scaleBytes, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
    this.noiseBuffer = createBuffer(device, "low frequency noise", scalarBytes, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
    this.globalsBuffer = createBuffer(device, "globals", 32, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
    this.viewBuffer = createBuffer(device, "view params", 32, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);

    this.createFftParamBuffers();
    this.createReductionBuffers();
    this.createScaleIndexBuffers(scaleCount);
    this.bindGroupCache.clear();
    this.hasViewBackup = false;
    this.writeView();
  }

  resizePresentation() {
    const rect = this.canvas.getBoundingClientRect();
    const pixelRatio = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.round((rect.width || this.size) * pixelRatio));
    const height = Math.max(1, Math.round((rect.height || this.size) * pixelRatio));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
      this.bindGroupCache.clear();
      this.writeView();
    }
  }

  createFftParamBuffers() {
    this.fftParamBuffers.clear();
    for (const inverse of [false, true]) {
      for (const horizontal of [true, false]) {
        for (let stage = 0; stage < this.logSize; stage += 1) {
          const isLastStage = stage === this.logSize - 1;
          const normalize = inverse && isLastStage ? 1 / this.size : 1;
          const key = this.fftKey(stage, inverse, horizontal);
          const buffer = createBuffer(this.device, `fft params ${key}`, 32, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
          this.device.queue.writeBuffer(
            buffer,
            0,
            fftParamData(this.size, stage, inverse, horizontal, this.logSize, normalize),
          );
          this.fftParamBuffers.set(key, buffer);
        }
      }
      for (const horizontal of [true, false]) {
        const key = this.bitReverseKey(inverse, horizontal);
        const buffer = createBuffer(this.device, `bit reverse params ${key}`, 32, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
        this.device.queue.writeBuffer(
          buffer,
          0,
          fftParamData(this.size, 0, inverse, horizontal, this.logSize, 1),
        );
        this.fftParamBuffers.set(key, buffer);
      }
    }
  }

  createReductionBuffers() {
    this.reductionBuffers = [];
    this.reduceParamBuffers = [];
    let inputLength = this.cellCount;
    while (inputLength > 1) {
      const outputLength = Math.ceil(inputLength / WORKGROUP_SIZE);
      this.reductionBuffers.push(
        createBuffer(this.device, `reduction ${outputLength}`, outputLength * 8, GPUBufferUsage.STORAGE),
      );
      const params = createBuffer(this.device, `reduction params ${outputLength}`, 16, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
      this.device.queue.writeBuffer(params, 0, reduceParamData(inputLength, outputLength));
      this.reduceParamBuffers.push({ buffer: params, inputLength, outputLength });
      inputLength = outputLength;
    }
  }

  createScaleIndexBuffers(scaleCount) {
    this.scaleIndexBuffers = [];
    for (let i = 0; i < Math.max(1, scaleCount); i += 1) {
      this.scaleIndexBuffers.push(writeU32Uniform(this.device, [i, 0, 0, 0]));
    }
  }

  writeGlobals() {
    const data = new ArrayBuffer(32);
    const view = new DataView(data);
    view.setUint32(0, this.size, true);
    view.setUint32(4, this.cellCount, true);
    view.setUint32(8, this.config.scales.length, true);
    view.setUint32(12, this.config.colorEnabled ? 1 : 0, true);
    view.setFloat32(16, this.config.noiseStrength, true);
    view.setUint32(20, this.stepCount >>> 0, true);
    this.device.queue.writeBuffer(this.globalsBuffer, 0, data);
  }

  writeScaleParams(scales) {
    const data = new Float32Array(Math.max(1, scales.length) * 12);
    scales.forEach((scale, index) => {
      const offset = index * 12;
      const color = hexToRgb01(scale.color);
      data[offset] = scale.amount;
      data[offset + 1] = scale.weight;
      data[offset + 2] = scale.symmetry;
      data[offset + 3] = scale.activatorRadius;
      data[offset + 4] = scale.inhibitorRatio;
      data[offset + 5] = 0;
      data[offset + 6] = 0;
      data[offset + 7] = 0;
      data[offset + 8] = color[0];
      data[offset + 9] = color[1];
      data[offset + 10] = color[2];
      data[offset + 11] = 1;
    });
    this.device.queue.writeBuffer(this.scaleParamBuffer, 0, data);
  }

  async rebuildKernelSpectra(scales) {
    const complexBytes = this.cellCount * 8;
    for (let i = 0; i < scales.length; i += 1) {
      const spatialKernel = buildDifferenceKernel(this.size, scales[i]);
      this.device.queue.writeBuffer(this.kernelPrepA, 0, spatialKernel);
      const encoder = this.device.createCommandEncoder({ label: `kernel fft ${i}` });
      const active = this.encodeFft(encoder, this.kernelPrepA, this.kernelPrepA, this.kernelPrepB, false);
      encoder.copyBufferToBuffer(active, 0, this.kernelSpectraBuffer, i * complexBytes, complexBytes);
      this.device.queue.submit([encoder.finish()]);
    }
    await this.device.queue.onSubmittedWorkDone();
  }

  writeNoiseField() {
    this.device.queue.writeBuffer(
      this.noiseBuffer,
      0,
      createLowFrequencyNoise(this.size, this.config.seed, this.config.noiseScale),
    );
  }

  setView(view) {
    this.view = {
      zoom: Math.min(64, Math.max(1, Number(view.zoom) || 1)),
      panX: Number(view.panX) || 0,
      panY: Number(view.panY) || 0,
    };
    this.writeView();
  }

  resetView() {
    this.setView({ zoom: 1, panX: 0, panY: 0 });
  }

  reprojectView(view) {
    const nextView = {
      zoom: Math.min(64, Math.max(0.125, Number(view.zoom) || 1)),
      panX: Number(view.panX) || 0,
      panY: Number(view.panY) || 0,
    };
    if (
      Math.abs(nextView.zoom - 1) < 0.000001 &&
      Math.abs(nextView.panX) < 0.000001 &&
      Math.abs(nextView.panY) < 0.000001
    ) {
      return;
    }

    this.backupViewspace();
    const previousView = this.view;
    this.view = nextView;
    this.writeView();
    const encoder = this.device.createCommandEncoder({ label: "reproject viewspace" });
    if (this.config?.mode === "bz") {
      this.encodeCompute(encoder, this.reprojectBzPipeline, [
        this.globalsBuffer,
        this.viewBuffer,
        this.bzA,
        this.bzB,
      ], this.cellCount);
      [this.bzA, this.bzB] = [this.bzB, this.bzA];
    } else {
      this.encodeCompute(encoder, this.reprojectTuringPipeline, [
        this.globalsBuffer,
        this.viewBuffer,
        this.fieldBuffer,
        this.nextFieldBuffer,
        this.colorA,
        this.colorB,
      ], this.cellCount);
      [this.fieldBuffer, this.nextFieldBuffer] = [this.nextFieldBuffer, this.fieldBuffer];
      [this.colorA, this.colorB] = [this.colorB, this.colorA];
    }
    this.device.queue.submit([encoder.finish()]);
    this.view = previousView;
    this.writeView();
    this.bindGroupCache.clear();
  }

  backupViewspace() {
    if (this.hasViewBackup) {
      return;
    }
    const encoder = this.device.createCommandEncoder({ label: "backup viewspace" });
    if (this.config?.mode === "bz") {
      encoder.copyBufferToBuffer(this.bzA, 0, this.bzViewBackup, 0, this.colorBytes);
    } else {
      encoder.copyBufferToBuffer(this.fieldBuffer, 0, this.fieldViewBackup, 0, this.scalarBytes);
      encoder.copyBufferToBuffer(this.colorA, 0, this.colorViewBackup, 0, this.colorBytes);
    }
    this.device.queue.submit([encoder.finish()]);
    this.hasViewBackup = true;
  }

  restoreViewspace() {
    if (!this.hasViewBackup) {
      this.resetView();
      return false;
    }
    const encoder = this.device.createCommandEncoder({ label: "restore viewspace" });
    if (this.config?.mode === "bz") {
      encoder.copyBufferToBuffer(this.bzViewBackup, 0, this.bzA, 0, this.colorBytes);
    } else {
      encoder.copyBufferToBuffer(this.fieldViewBackup, 0, this.fieldBuffer, 0, this.scalarBytes);
      encoder.copyBufferToBuffer(this.colorViewBackup, 0, this.colorA, 0, this.colorBytes);
    }
    this.device.queue.submit([encoder.finish()]);
    this.hasViewBackup = false;
    this.resetView();
    this.bindGroupCache.clear();
    return true;
  }

  writeView() {
    if (!this.viewBuffer) {
      return;
    }
    this.device.queue.writeBuffer(
      this.viewBuffer,
      0,
      new Float32Array([
        this.view.zoom,
        this.view.panX,
        this.view.panY,
        this.canvas.width,
        this.canvas.height,
        0,
        0,
        0,
      ]),
    );
  }

  getView() {
    return { ...this.view };
  }

  resetField(seed = this.config.seed) {
    this.stepCount = 0;
    this.hasViewBackup = false;
    this.device.queue.writeBuffer(this.fieldBuffer, 0, createInitialField(this.size, seed));
    this.device.queue.writeBuffer(this.colorA, 0, createInitialColors(this.size));
    this.device.queue.writeBuffer(this.colorB, 0, createInitialColors(this.size));
    this.device.queue.writeBuffer(this.bzA, 0, createInitialBzState(this.size, seed, this.config.noiseScale));
    this.device.queue.writeBuffer(this.bzB, 0, createInitialBzState(this.size, seed ^ 0x7f4a7c15, this.config.noiseScale));
  }

  step(iterations = 1) {
    for (let i = 0; i < iterations; i += 1) {
      const encoder = this.device.createCommandEncoder({ label: "turing step" });
      this.writeGlobals();
      if (this.config.mode === "bz") {
        this.encodeBzStep(encoder);
      } else {
        this.encodeStep(encoder);
      }
      this.device.queue.submit([encoder.finish()]);
      this.stepCount += 1;
    }
  }

  encodeBzStep(encoder) {
    this.encodeCompute(encoder, this.bzStepPipeline, [
      this.globalsBuffer,
      this.scaleParamBuffer,
      this.bzA,
      this.bzB,
      this.noiseBuffer,
    ], this.cellCount);

    [this.bzA, this.bzB] = [this.bzB, this.bzA];
  }

  encodeStep(encoder) {
    this.encodeCompute(encoder, this.preparePipeline, [
      this.globalsBuffer,
      this.fieldBuffer,
      this.complexA,
    ], this.cellCount);

    const spectrum = this.encodeFft(encoder, this.complexA, this.complexA, this.complexB, false);

    for (let scale = 0; scale < this.config.scales.length; scale += 1) {
      this.encodeCompute(encoder, this.multiplyPipeline, [
        this.globalsBuffer,
        this.scaleIndexBuffers[scale],
        spectrum,
        this.kernelSpectraBuffer,
        this.convolutionA,
      ], this.cellCount);

      const convolution = this.encodeFft(encoder, this.convolutionA, this.convolutionA, this.convolutionB, true);

      this.encodeCompute(encoder, this.diffPipeline, [
        this.globalsBuffer,
        this.scaleParamBuffer,
        this.scaleIndexBuffers[scale],
        convolution,
        this.diffBuffer,
      ], this.cellCount);
    }

    this.encodeCompute(encoder, this.selectPipeline, [
      this.globalsBuffer,
      this.scaleParamBuffer,
      this.fieldBuffer,
      this.nextFieldBuffer,
      this.diffBuffer,
      this.colorA,
      this.colorB,
      this.noiseBuffer,
    ], this.cellCount);

    this.encodeReduction(encoder);
    this.encodeCompute(encoder, this.normalizePipeline, [
      this.globalsBuffer,
      this.nextFieldBuffer,
      this.reductionBuffers.at(-1),
      this.fieldBuffer,
    ], this.cellCount);

    [this.colorA, this.colorB] = [this.colorB, this.colorA];
  }

  encodeReduction(encoder) {
    this.encodeCompute(encoder, this.reduceFieldPipeline, [
      this.reduceParamBuffers[0].buffer,
      this.nextFieldBuffer,
      this.reductionBuffers[0],
    ], this.reduceParamBuffers[0].outputLength);

    for (let level = 1; level < this.reductionBuffers.length; level += 1) {
      this.encodeCompute(encoder, this.reduceMinMaxPipeline, [
        this.reduceParamBuffers[level].buffer,
        this.reductionBuffers[level - 1],
        this.reductionBuffers[level],
      ], this.reduceParamBuffers[level].outputLength);
    }
  }

  render() {
    this.resizePresentation();
    if (this.config?.mode === "bz") {
      this.renderBz();
      return;
    }

    const textureView = this.context.getCurrentTexture().createView();
    const encoder = this.device.createCommandEncoder({ label: "render" });
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: textureView,
        clearValue: { r: 0.02, g: 0.018, b: 0.014, a: 1 },
        loadOp: "clear",
        storeOp: "store",
      }],
    });
    pass.setPipeline(this.renderPipeline);
    pass.setBindGroup(0, this.getBindGroup(this.renderPipeline, [
      this.globalsBuffer,
      this.fieldBuffer,
      this.colorA,
      this.viewBuffer,
    ]));
    pass.draw(3);
    pass.end();
    this.device.queue.submit([encoder.finish()]);
  }

  renderBz() {
    const textureView = this.context.getCurrentTexture().createView();
    const encoder = this.device.createCommandEncoder({ label: "render bz" });
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: textureView,
        clearValue: { r: 0.015, g: 0.018, b: 0.017, a: 1 },
        loadOp: "clear",
        storeOp: "store",
      }],
    });
    pass.setPipeline(this.bzRenderPipeline);
    pass.setBindGroup(0, this.getBindGroup(this.bzRenderPipeline, [
      this.globalsBuffer,
      this.bzA,
      this.scaleParamBuffer,
      this.noiseBuffer,
      this.viewBuffer,
    ]));
    pass.draw(3);
    pass.end();
    this.device.queue.submit([encoder.finish()]);
  }

  encodeFft(encoder, input, bufferA, bufferB, inverse) {
    let read = input;
    let write = read === bufferA ? bufferB : bufferA;
    this.encodeBitReverse(encoder, read, write, inverse, true);
    [read, write] = [write, read];

    for (let stage = 0; stage < this.logSize; stage += 1) {
      this.encodeFftStage(encoder, read, write, stage, inverse, true);
      [read, write] = [write, read];
    }

    write = read === bufferA ? bufferB : bufferA;
    this.encodeBitReverse(encoder, read, write, inverse, false);
    [read, write] = [write, read];

    for (let stage = 0; stage < this.logSize; stage += 1) {
      this.encodeFftStage(encoder, read, write, stage, inverse, false);
      [read, write] = [write, read];
    }

    return read;
  }

  encodeBitReverse(encoder, input, output, inverse, horizontal) {
    const params = this.fftParamBuffers.get(this.bitReverseKey(inverse, horizontal));
    this.encodeCompute(encoder, this.bitReversePipeline, [params, input, output], this.cellCount);
  }

  encodeFftStage(encoder, input, output, stage, inverse, horizontal) {
    const params = this.fftParamBuffers.get(this.fftKey(stage, inverse, horizontal));
    this.encodeCompute(encoder, this.fftPipeline, [params, input, output], this.cellCount / 2);
  }

  encodeCompute(encoder, pipeline, buffers, itemCount) {
    const pass = encoder.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, this.getBindGroup(pipeline, buffers));
    pass.dispatchWorkgroups(Math.ceil(itemCount / WORKGROUP_SIZE));
    pass.end();
  }

  getBindGroup(pipeline, buffers) {
    const key = `${pipeline.label}:${buffers.map((buffer) => this.bufferKey(buffer)).join("|")}`;
    const cached = this.bindGroupCache.get(key);
    if (cached) {
      return cached;
    }
    const bindGroup = this.device.createBindGroup({
      label: key,
      layout: pipeline.getBindGroupLayout(0),
      entries: buffers.map((buffer, binding) => ({
        binding,
        resource: { buffer },
      })),
    });
    this.bindGroupCache.set(key, bindGroup);
    return bindGroup;
  }

  bufferKey(buffer) {
    let id = this.bufferIds.get(buffer);
    if (!id) {
      id = this.nextBufferId;
      this.nextBufferId += 1;
      this.bufferIds.set(buffer, id);
    }
    return `${id}:${buffer.label || "buffer"}`;
  }

  fftKey(stage, inverse, horizontal) {
    return `${stage}:${inverse ? 1 : 0}:${horizontal ? 1 : 0}`;
  }

  bitReverseKey(inverse, horizontal) {
    return `bit:${inverse ? 1 : 0}:${horizontal ? 1 : 0}`;
  }
}
