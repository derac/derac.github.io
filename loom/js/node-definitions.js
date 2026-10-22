const p = {
  range(id, label, min, max, step, value, randomMin = min, randomMax = max) {
    if (isSpeedParam(id)) {
      min = -0.1;
      max = 0.1;
      value = clamp(value, min, max);
      randomMin = clamp(randomMin, min, max);
      randomMax = clamp(randomMax, min, max);
    }
    return { id, label, type: "range", min, max, step, default: value, random: { min: randomMin, max: randomMax } };
  },
  number(id, label, min, max, step, value, randomMin = min, randomMax = max) {
    return { id, label, type: "number", min, max, step, default: value, random: { min: randomMin, max: randomMax } };
  },
  color(id, label, value) {
    return { id, label, type: "color", default: value };
  },
  toggle(id, label, value) {
    return { id, label, type: "toggle", default: value };
  },
  select(id, label, options, value) {
    return { id, label, type: "select", options, default: value };
  }
};

const SCALAR_TYPE = "scalar";
const input = (id, label, required = false, fallback = null) => ({ id, type: SCALAR_TYPE, label, required, fallback });
const output = (id, label) => ({ id, type: SCALAR_TYPE, label });

function xyInput(id, label = "", required = false) {
  return [
    input(componentPortId(id, "X"), componentLabel(label, "x"), required, id === "coord" ? "world.x" : "0.0"),
    input(componentPortId(id, "Y"), componentLabel(label, "y"), required, id === "coord" ? "world.y" : "0.0")
  ];
}

function xyOutput(id, label = "") {
  return [
    output(componentPortId(id, "X"), componentLabel(label, "x")),
    output(componentPortId(id, "Y"), componentLabel(label, "y"))
  ];
}

function rgbaInput(id, label = "", required = false) {
  return [
    input(componentPortId(id, "R"), componentLabel(label, "r"), required, "0.0"),
    input(componentPortId(id, "G"), componentLabel(label, "g"), required, "0.0"),
    input(componentPortId(id, "B"), componentLabel(label, "b"), required, "0.0"),
    input(componentPortId(id, "A"), componentLabel(label, "a"), required, "1.0")
  ];
}

function rgbaOutput(id, label = "") {
  return [
    output(componentPortId(id, "R"), componentLabel(label, "r")),
    output(componentPortId(id, "G"), componentLabel(label, "g")),
    output(componentPortId(id, "B"), componentLabel(label, "b")),
    output(componentPortId(id, "A"), componentLabel(label, "a"))
  ];
}

function componentPortId(portId, suffix) {
  return `${portId}${suffix}`;
}

function componentLabel(label, component) {
  return label ? `${label} ${component}` : component;
}

export function createRawNodeDefinitions() {
  return {
  coordinates: {
    type: "coordinates",
    label: "Coordinates",
    category: "Input",
    inputs: [],
    outputs: [...xyOutput("coord")],
    params: [],
    emit: ({ out }) => `let ${out("coord")} = world;`
  },
  time: {
    type: "time",
    label: "Time",
    category: "Input",
    inputs: [],
    outputs: [output("value", "time")],
    params: [p.range("scale", "Scale", -4, 4, 0.01, 1, -2, 2)],
    emit: ({ out, param }) => `let ${out("value")} = frame.time * ${param("scale")};`
  },
  constant: {
    type: "constant",
    label: "Constant",
    category: "Input",
    inputs: [],
    outputs: [output("value", "value")],
    params: [p.range("value", "Value", -8, 8, 0.001, 0.5, -1, 1)],
    emit: ({ out, param }) => `let ${out("value")} = ${param("value")};`
  },
  mouse: {
    type: "mouse",
    label: "Mouse",
    category: "Input",
    inputs: [],
    outputs: [...xyOutput("coord")],
    params: [],
    emit: ({ out }) => `let ${out("coord")} = frame.mouse;`
  },
  audioInput: {
    type: "audioInput",
    label: "Audio Input",
    category: "Input",
    inputs: [],
    outputs: [output("value", "value")],
    params: [
      p.select("band", "Band", [
        { label: "Full", value: 0 },
        { label: "Bass", value: 1 },
        { label: "Mids", value: 2 },
        { label: "Treble", value: 3 },
        { label: "Focus", value: 4 },
        { label: "Beat", value: 5 }
      ], 0),
      p.range("gain", "Gain", 0, 8, 0.001, 1, 3, 8)
    ],
    emit: ({ out, param }) => `
var ${out("value")}_raw = frame.audioLevel;
if (i32(round(${param("band")})) == 1) { ${out("value")}_raw = frame.audioBands.x; }
if (i32(round(${param("band")})) == 2) { ${out("value")}_raw = frame.audioBands.y; }
if (i32(round(${param("band")})) == 3) { ${out("value")}_raw = frame.audioBands.z; }
if (i32(round(${param("band")})) == 4) { ${out("value")}_raw = frame.audioBands.w; }
if (i32(round(${param("band")})) == 5) { ${out("value")}_raw = frame.beat; }
let ${out("value")} = clamp(${out("value")}_raw * ${param("gain")}, 0.0, 4.0);`
  },
  audioSplit: {
    type: "audioSplit",
    label: "Audio Split",
    category: "Input",
    inputs: [],
    outputs: [
      output("level", "level"),
      output("bass", "bass"),
      output("mids", "mids"),
      output("treble", "treble"),
      output("focus", "focus"),
      output("beat", "beat")
    ],
    params: [p.range("gain", "Gain", 0, 8, 0.001, 1, 3, 8)],
    emit: ({ out, param }) => `
let ${out("level")} = clamp(frame.audioLevel * ${param("gain")}, 0.0, 4.0);
let ${out("bass")} = clamp(frame.audioBands.x * ${param("gain")}, 0.0, 4.0);
let ${out("mids")} = clamp(frame.audioBands.y * ${param("gain")}, 0.0, 4.0);
let ${out("treble")} = clamp(frame.audioBands.z * ${param("gain")}, 0.0, 4.0);
let ${out("focus")} = clamp(frame.audioBands.w * ${param("gain")}, 0.0, 4.0);
let ${out("beat")} = clamp(frame.beat * ${param("gain")}, 0.0, 4.0);`
  },
  mouseDistance: {
    type: "mouseDistance",
    label: "Mouse Distance",
    category: "Input",
    inputs: [...xyInput("coord")],
    outputs: [output("value", "distance")],
    params: [p.range("scale", "Scale", 0.01, 8, 0.001, 1, 0.4, 2.2), p.range("falloff", "Falloff", 0.1, 8, 0.001, 1, 0.6, 2.5)],
    emit: ({ input, out, param }) => `
let ${out("value")}_d = length(${input("coord")} - frame.mouse) * ${param("scale")};
let ${out("value")} = pow(clamp(1.0 - ${out("value")}_d, 0.0, 1.0), max(${param("falloff")}, 0.0001));`
  },
  mouseAngle: {
    type: "mouseAngle",
    label: "Mouse Angle",
    category: "Input",
    inputs: [...xyInput("coord")],
    outputs: [output("value", "angle")],
    params: [p.range("turns", "Turns", 0.1, 16, 0.001, 1, 0.5, 4), p.range("offset", "Offset", -1, 1, 0.001, 0, -0.25, 0.25)],
    emit: ({ input, out, param }) => `
let ${out("value")}_p = ${input("coord")} - frame.mouse;
let ${out("value")}_a = atan2(${out("value")}_p.y, ${out("value")}_p.x) / 6.2831853;
let ${out("value")} = fract(${out("value")}_a * ${param("turns")} + ${param("offset")} + 1.0);`
  },
  resolution: {
    type: "resolution",
    label: "Resolution",
    category: "Input",
    inputs: [],
    outputs: [output("width", "width"), output("height", "height"), output("aspect", "aspect")],
    params: [],
    emit: ({ out }) => `
let ${out("width")} = frame.resolution.x;
let ${out("height")} = frame.resolution.y;
let ${out("aspect")} = frame.resolution.x / max(frame.resolution.y, 1.0);`
  },
  randomValue: {
    type: "randomValue",
    label: "Random Value",
    category: "Input",
    inputs: [input("time", "time", false, "frame.time")],
    outputs: [output("value", "value")],
    params: [
      p.range("seed", "Seed", 0, 999, 1, 37, 0, 999),
      p.range("rate", "Rate", 0, 24, 0.001, 0, 0, 2),
      p.toggle("stepped", "Stepped", true)
    ],
    emit: ({ input, out, param }) => `
let ${out("value")}_t = select(${input("time")} * ${param("rate")}, floor(${input("time")} * ${param("rate")}), ${param("stepped")} > 0.5);
let ${out("value")} = hash21(vec2f(${param("seed")}, ${out("value")}_t));`
  },
  sineWave: {
    type: "sineWave",
    label: "Sine Wave",
    category: "Field",
    inputs: [
      ...xyInput("coord"),
      input("time", "time", false, "frame.time"),
      input("frequencyMod", "freq"),
      input("phaseMod", "phase")
    ],
    outputs: [output("value", "value")],
    params: [
      p.range("frequency", "Frequency", 0.05, 40, 0.01, 4, 0.5, 11),
      p.range("amplitude", "Amplitude", 0, 3, 0.01, 1, 0.2, 1.5),
      p.range("angle", "Angle", -3.14159, 3.14159, 0.001, 0.4, -0.7, 0.7),
      p.range("phase", "Phase", -12.566, 12.566, 0.001, 0, -3.14159, 3.14159),
      p.range("speed", "Speed", -8, 8, 0.01, 0.65, -0.6, 0.6)
    ],
    emit: ({ input, out, param }) => `
let ${out("value")}_dir = vec2f(cos(${param("angle")}), sin(${param("angle")}));
let ${out("value")}_freq = max(0.001, ${param("frequency")} + ${input("frequencyMod")});
let ${out("value")}_phase = ${input("time")} * ${param("speed")} * ${out("value")}_freq;
let ${out("value")} = (sin(dot(${input("coord")}, ${out("value")}_dir) * ${out("value")}_freq + ${out("value")}_phase + ${param("phase")} + ${input("phaseMod")}) * 0.5 + 0.5) * ${param("amplitude")};`
  },
  radialWave: {
    type: "radialWave",
    label: "Radial Wave",
    category: "Field",
    inputs: [
      ...xyInput("coord"),
      ...xyInput("center", "center"),
      input("time", "time", false, "frame.time"),
      input("frequencyMod", "freq")
    ],
    outputs: [output("value", "value")],
    params: [
      p.range("frequency", "Frequency", 0.05, 50, 0.01, 7, 1.5, 13),
      p.range("speed", "Speed", -8, 8, 0.01, 0.6, -0.6, 0.6),
      p.range("amplitude", "Amplitude", 0, 3, 0.01, 1, 0.2, 1.5)
    ],
    emit: ({ input, out, param }) => `
let ${out("value")}_p = ${input("coord")} - ${input("center")};
let ${out("value")}_r = length(${out("value")}_p);
let ${out("value")}_freq = max(0.001, ${param("frequency")} + ${input("frequencyMod")});
let ${out("value")}_phase = ${input("time")} * ${param("speed")} * ${out("value")}_freq;
let ${out("value")} = (sin(${out("value")}_r * ${out("value")}_freq - ${out("value")}_phase) * 0.5 + 0.5) * ${param("amplitude")};`
  },
  noise: {
    type: "noise",
    label: "Noise",
    category: "Field",
    inputs: [
      ...xyInput("coord"),
      input("time", "time", false, "frame.time"),
      input("scaleMod", "scale")
    ],
    outputs: [output("value", "value")],
    params: [
      p.range("scale", "Scale", 0.05, 36, 0.01, 5, 0.8, 11),
      p.range("speed", "Speed", -4, 4, 0.01, 0.1, -0.25, 0.25),
      p.range("seed", "Seed", 0, 999, 1, 11, 0, 999)
    ],
    emit: ({ input, out, param }) => `
let ${out("value")}_scale = max(0.001, ${param("scale")} + ${input("scaleMod")});
let ${out("value")}_p = ${input("coord")} * ${out("value")}_scale + vec2f(${param("seed")} * 0.037, ${input("time")} * ${param("speed")} * ${out("value")}_scale);
let ${out("value")} = noise2(${out("value")}_p);`
  },
  fbmNoise: {
    type: "fbmNoise",
    label: "FBM Noise",
    category: "Field",
    inputs: [
      ...xyInput("coord"),
      input("time", "time", false, "frame.time"),
      input("scaleMod", "scale")
    ],
    outputs: [output("value", "value")],
    params: [
      p.range("scale", "Scale", 0.05, 28, 0.01, 3.2, 0.6, 7.5),
      p.range("octaves", "Octaves", 1, 8, 1, 5, 2, 6),
      p.range("gain", "Gain", 0.1, 0.9, 0.01, 0.48, 0.35, 0.7),
      p.range("lacunarity", "Lacunarity", 1.1, 3.8, 0.01, 2.02, 1.7, 2.7),
      p.range("speed", "Speed", -3, 3, 0.01, 0.35, -0.25, 0.25),
      p.range("seed", "Seed", 0, 999, 1, 42, 0, 999)
    ],
    emit: ({ input, out, param }) => `
let ${out("value")}_scale = max(0.001, ${param("scale")} + ${input("scaleMod")});
let ${out("value")}_p = ${input("coord")} * ${out("value")}_scale + vec2f(${param("seed")} * 0.041, ${input("time")} * ${param("speed")} * ${out("value")}_scale);
let ${out("value")} = fbm2(${out("value")}_p, ${param("octaves")}, ${param("gain")}, ${param("lacunarity")});`
  },
  ridgeNoise: {
    type: "ridgeNoise",
    label: "Ridge Noise",
    category: "Field",
    inputs: [
      ...xyInput("coord"),
      input("time", "time", false, "frame.time"),
      input("scaleMod", "scale")
    ],
    outputs: [output("value", "value")],
    params: [
      p.range("scale", "Scale", 0.05, 30, 0.01, 4, 0.8, 8),
      p.range("octaves", "Octaves", 1, 8, 1, 5, 2, 6),
      p.range("gain", "Gain", 0.1, 0.9, 0.01, 0.5, 0.35, 0.7),
      p.range("lacunarity", "Lacunarity", 1.1, 3.8, 0.01, 2.05, 1.7, 2.7),
      p.range("sharpness", "Sharpness", 0.25, 5, 0.001, 1.4, 0.8, 2.8),
      p.range("speed", "Drift", -3, 3, 0.01, 0.04, -0.08, 0.08),
      p.range("seed", "Seed", 0, 999, 1, 73, 0, 999)
    ],
    emit: ({ input, out, param }) => `
let ${out("value")}_scale = max(0.001, ${param("scale")} + ${input("scaleMod")});
let ${out("value")}_p = ${input("coord")} * ${out("value")}_scale + vec2f(${param("seed")} * 0.031, ${input("time")} * ${param("speed")} * ${out("value")}_scale);
let ${out("value")} = pow(clamp(ridgedFbm2(${out("value")}_p, ${param("octaves")}, ${param("gain")}, ${param("lacunarity")}), 0.0, 1.0), max(${param("sharpness")}, 0.0001));`
  },
  turbulenceNoise: {
    type: "turbulenceNoise",
    label: "Turbulence",
    category: "Field",
    inputs: [
      ...xyInput("coord"),
      input("time", "time", false, "frame.time"),
      input("scaleMod", "scale")
    ],
    outputs: [output("value", "value")],
    params: [
      p.range("scale", "Scale", 0.05, 30, 0.01, 3.2, 0.7, 7),
      p.range("octaves", "Octaves", 1, 8, 1, 5, 2, 6),
      p.range("gain", "Gain", 0.1, 0.9, 0.01, 0.52, 0.35, 0.72),
      p.range("lacunarity", "Lacunarity", 1.1, 3.8, 0.01, 2.03, 1.7, 2.7),
      p.range("contrast", "Contrast", 0.1, 4, 0.001, 1.15, 0.7, 2.2),
      p.range("speed", "Drift", -3, 3, 0.01, 0.04, -0.08, 0.08),
      p.range("seed", "Seed", 0, 999, 1, 91, 0, 999)
    ],
    emit: ({ input, out, param }) => `
let ${out("value")}_scale = max(0.001, ${param("scale")} + ${input("scaleMod")});
let ${out("value")}_p = ${input("coord")} * ${out("value")}_scale + vec2f(${param("seed")} * 0.027, ${input("time")} * ${param("speed")} * ${out("value")}_scale);
let ${out("value")}_raw = turbulence2(${out("value")}_p, ${param("octaves")}, ${param("gain")}, ${param("lacunarity")});
let ${out("value")} = clamp((${out("value")}_raw - 0.5) * ${param("contrast")} + 0.5, 0.0, 1.0);`
  },
  voronoi: {
    type: "voronoi",
    label: "Voronoi",
    category: "Field",
    inputs: [
      ...xyInput("coord"),
      input("time", "time", false, "frame.time"),
      input("scaleMod", "scale")
    ],
    outputs: [output("value", "value")],
    params: [
      p.range("scale", "Scale", 0.2, 30, 0.01, 5, 0.8, 10),
      p.range("jitter", "Jitter", 0, 1.8, 0.01, 0.9, 0.3, 1.2),
      p.range("speed", "Speed", -3, 3, 0.01, 0.08, -0.2, 0.2)
    ],
    emit: ({ input, out, param }) => `
let ${out("value")}_scale = max(0.001, ${param("scale")} + ${input("scaleMod")});
let ${out("value")} = voronoi2(${input("coord")} * ${out("value")}_scale + vec2f(${input("time")} * ${param("speed")} * ${out("value")}_scale, 0.0), ${param("jitter")});`
  },
  checker: {
    type: "checker",
    label: "Checker",
    category: "Field",
    inputs: [...xyInput("coord"), input("time", "time", false, "frame.time")],
    outputs: [output("value", "value")],
    params: [
      p.range("scale", "Scale", 0.1, 60, 0.01, 8, 2, 16),
      p.range("softness", "Softness", 0, 0.5, 0.001, 0.02, 0, 0.12),
      p.range("angle", "Angle", -3.14159, 3.14159, 0.001, 0, -0.35, 0.35),
      p.range("speed", "Spin", -6, 6, 0.01, 0.12, -0.12, 0.12)
    ],
    emit: ({ input, out, param }) => `
let ${out("value")}_coord = rotate2(${input("coord")}, ${param("angle")} + ${input("time")} * ${param("speed")});
let ${out("value")}_p = fract(${out("value")}_coord * ${param("scale")});
let ${out("value")}_soft = max(${param("softness")}, 0.0001);
let ${out("value")}_cx = smoothstep(0.5 - ${out("value")}_soft, 0.5 + ${out("value")}_soft, ${out("value")}_p.x);
let ${out("value")}_cy = smoothstep(0.5 - ${out("value")}_soft, 0.5 + ${out("value")}_soft, ${out("value")}_p.y);
let ${out("value")} = abs(${out("value")}_cx - ${out("value")}_cy);`
  },
  spiral: {
    type: "spiral",
    label: "Spiral",
    category: "Field",
    inputs: [
      ...xyInput("coord"),
      ...xyInput("center", "center"),
      input("time", "time", false, "frame.time")
    ],
    outputs: [output("value", "value")],
    params: [
      p.range("arms", "Arms", 1, 18, 1, 5, 2, 9),
      p.range("twist", "Twist", -24, 24, 0.01, 8, -5, 5),
      p.range("speed", "Speed", -8, 8, 0.01, 0.4, -0.7, 0.7)
    ],
    emit: ({ input, out, param }) => `
let ${out("value")}_p = ${input("coord")} - ${input("center")};
let ${out("value")}_ang = atan2(${out("value")}_p.y, ${out("value")}_p.x);
let ${out("value")}_rad = length(${out("value")}_p);
let ${out("value")} = sin(${out("value")}_ang * ${param("arms")} + ${out("value")}_rad * ${param("twist")} - ${input("time")} * ${param("speed")}) * 0.5 + 0.5;`
  },
  sineLattice: {
    type: "sineLattice",
    label: "Sine Lattice",
    category: "Field",
    inputs: [
      ...xyInput("coord"),
      input("time", "time", false, "frame.time"),
      input("scaleMod", "scale"),
      input("phaseMod", "phase")
    ],
    outputs: [output("value", "value")],
    params: [
      p.range("scale", "Scale", 0.05, 40, 0.01, 7, 1.5, 12),
      p.range("skew", "Skew", -4, 4, 0.001, 0.8, -1, 1.6),
      p.range("speed", "Speed", -8, 8, 0.01, 0.7, -0.6, 0.6),
      p.range("contrast", "Contrast", 0.1, 4, 0.001, 1, 0.6, 2)
    ],
    emit: ({ input, out, param }) => `
let ${out("value")}_scale = max(0.001, ${param("scale")} + ${input("scaleMod")});
let ${out("value")}_t = ${input("time")} * ${param("speed")} * ${out("value")}_scale + ${input("phaseMod")};
let ${out("value")}_raw = sin(${input("coord")}.x * ${out("value")}_scale + ${out("value")}_t) + sin((${input("coord")}.y + ${input("coord")}.x * ${param("skew")}) * ${out("value")}_scale - ${out("value")}_t);
let ${out("value")} = clamp((${out("value")}_raw * 0.25) * ${param("contrast")} + 0.5, 0.0, 1.0);`
  },
  hexGrid: {
    type: "hexGrid",
    label: "Hex Grid",
    category: "Field",
    inputs: [
      ...xyInput("coord"),
      input("time", "time", false, "frame.time"),
      input("scaleMod", "scale")
    ],
    outputs: [output("value", "value")],
    params: [
      p.range("scale", "Scale", 0.1, 40, 0.01, 8, 1.5, 12),
      p.range("balance", "Balance", 0, 2, 0.001, 1, 0.5, 1.5),
      p.range("angle", "Angle", -3.14159, 3.14159, 0.001, 0, -0.35, 0.35),
      p.range("speed", "Speed", -8, 8, 0.01, 0.45, -0.5, 0.5)
    ],
    emit: ({ input, out, param }) => `
let ${out("value")}_p = rotate2(${input("coord")}, ${param("angle")});
let ${out("value")}_scale = max(0.001, ${param("scale")} + ${input("scaleMod")});
let ${out("value")}_t = ${input("time")} * ${param("speed")} * ${out("value")}_scale;
let ${out("value")}_raw = sin(dot(${out("value")}_p, vec2f(1.0, 0.0)) * ${out("value")}_scale + ${out("value")}_t)
  + sin(dot(${out("value")}_p, vec2f(-0.5, 0.8660254)) * ${out("value")}_scale + ${out("value")}_t * 0.93)
  + sin(dot(${out("value")}_p, vec2f(-0.5, -0.8660254)) * ${out("value")}_scale - ${out("value")}_t * 1.07) * ${param("balance")};
let ${out("value")} = clamp(${out("value")}_raw / max(2.0 * (2.0 + ${param("balance")}), 0.001) + 0.5, 0.0, 1.0);`
  },
  tunnel: {
    type: "tunnel",
    label: "Tunnel",
    category: "Field",
    inputs: [
      ...xyInput("coord"),
      ...xyInput("center", "center"),
      input("time", "time", false, "frame.time")
    ],
    outputs: [output("value", "value")],
    params: [
      p.range("depth", "Depth", 0.05, 12, 0.01, 2.8, 0.7, 4.5),
      p.range("rings", "Rings", 0, 30, 0.01, 9, 3, 13),
      p.range("twist", "Twist", -20, 20, 0.01, 4, -3, 3),
      p.range("speed", "Speed", -8, 8, 0.01, 0.7, -0.7, 0.7)
    ],
    emit: ({ input, out, param }) => `
let ${out("value")}_p = ${input("coord")} - ${input("center")};
let ${out("value")}_r = max(length(${out("value")}_p), 0.02);
let ${out("value")}_a = atan2(${out("value")}_p.y, ${out("value")}_p.x);
let ${out("value")}_t = ${input("time")} * ${param("speed")};
let ${out("value")}_raw = sin(${param("depth")} / ${out("value")}_r - ${out("value")}_t) + sin(${out("value")}_a * ${param("rings")} + ${param("twist")} / ${out("value")}_r + ${out("value")}_t * 0.37);
let ${out("value")} = clamp(${out("value")}_raw * 0.25 + 0.5, 0.0, 1.0);`
  },
  plasma: {
    type: "plasma",
    label: "Plasma",
    category: "Field",
    inputs: [
      ...xyInput("coord"),
      input("time", "time", false, "frame.time"),
      input("scaleMod", "scale")
    ],
    outputs: [output("value", "value")],
    params: [
      p.range("scale", "Scale", 0.1, 34, 0.01, 8, 1.5, 12),
      p.range("warp", "Warp", 0, 4, 0.001, 0.7, 0.15, 1.4),
      p.range("speed", "Speed", -8, 8, 0.01, 0.35, -0.45, 0.45),
      p.range("contrast", "Contrast", 0.1, 4, 0.001, 1, 0.6, 2.2)
    ],
    emit: ({ input, out, param }) => `
let ${out("value")}_scale = max(0.001, ${param("scale")} + ${input("scaleMod")});
let ${out("value")}_t = ${input("time")} * ${param("speed")} * ${out("value")}_scale;
let ${out("value")}_warpT = ${input("time")} * ${param("speed")};
let ${out("value")}_p = ${input("coord")} + vec2f(sin(${out("value")}_warpT * 0.37), cos(${out("value")}_warpT * 0.29)) * ${param("warp")};
let ${out("value")}_raw = sin(${out("value")}_p.x * ${out("value")}_scale + ${out("value")}_t)
  + sin((${out("value")}_p.y + ${out("value")}_p.x * 0.55) * ${out("value")}_scale * 0.63 - ${out("value")}_t * 0.7)
  + sin(length(${out("value")}_p) * ${out("value")}_scale + ${out("value")}_t * 1.31);
let ${out("value")} = clamp((${out("value")}_raw / 6.0) * ${param("contrast")} + 0.5, 0.0, 1.0);`
  },
  glitchBlocks: {
    type: "glitchBlocks",
    label: "Glitch Blocks",
    category: "Field",
    inputs: [...xyInput("coord"), input("time", "time", false, "frame.time")],
    outputs: [output("value", "value")],
    params: [
      p.range("scale", "Scale", 1, 80, 0.01, 18, 4, 22),
      p.range("aspect", "Aspect", 0.1, 8, 0.001, 1.6, 0.45, 2.6),
      p.range("speed", "Step Speed", 0, 24, 0.01, 5, 0.5, 6),
      p.range("threshold", "Threshold", 0, 1, 0.001, 0.48, 0.25, 0.7)
    ],
    emit: ({ input, out, param }) => `
let ${out("value")}_frame = floor(${input("time")} * ${param("speed")});
let ${out("value")}_cell = floor(vec2f(${input("coord")}.x * ${param("scale")}, ${input("coord")}.y * ${param("scale")} * ${param("aspect")}));
let ${out("value")}_raw = hash21(${out("value")}_cell + vec2f(${out("value")}_frame, ${out("value")}_frame * 0.31));
let ${out("value")}_scan = sin((${input("coord")}.y * ${param("scale")} * ${param("aspect")} + ${input("time")} * ${param("speed")}) * 12.0) * 0.08;
let ${out("value")} = smoothstep(${param("threshold")} - 0.15, ${param("threshold")} + 0.15, ${out("value")}_raw + ${out("value")}_scan);`
  },
  sawWave: {
    type: "sawWave",
    label: "Saw Wave",
    category: "Field",
    inputs: [
      ...xyInput("coord"),
      input("time", "time", false, "frame.time"),
      input("phaseMod", "phase")
    ],
    outputs: [output("value", "value")],
    params: [
      p.range("frequency", "Frequency", 0.05, 60, 0.01, 6, 1, 14),
      p.range("angle", "Angle", -3.14159, 3.14159, 0.001, 0, -0.7, 0.7),
      p.range("phase", "Phase", -8, 8, 0.001, 0, -2, 2),
      p.range("speed", "Speed", -8, 8, 0.01, 0.45, -0.55, 0.55),
      p.range("sharpness", "Sharpness", 0, 1, 0.001, 0.15, 0, 0.65)
    ],
    emit: ({ input, out, param }) => `
let ${out("value")}_dir = vec2f(cos(${param("angle")}), sin(${param("angle")}));
let ${out("value")}_freq = max(0.001, ${param("frequency")});
let ${out("value")}_cycle = dot(${input("coord")}, ${out("value")}_dir) * ${out("value")}_freq + ${input("time")} * ${param("speed")} * ${out("value")}_freq + ${param("phase")} + ${input("phaseMod")};
let ${out("value")}_saw = fract(${out("value")}_cycle);
let ${out("value")} = mix(${out("value")}_saw, step(0.5, ${out("value")}_saw), ${param("sharpness")});`
  },
  truchetTiles: {
    type: "truchetTiles",
    label: "Truchet Tiles",
    category: "Field",
    inputs: [...xyInput("coord"), input("time", "time", false, "frame.time")],
    outputs: [output("value", "value")],
    params: [
      p.range("scale", "Scale", 0.5, 36, 0.01, 8, 2, 12),
      p.range("width", "Line Width", 0.005, 0.3, 0.001, 0.055, 0.025, 0.12),
      p.range("softness", "Softness", 0.001, 0.2, 0.001, 0.025, 0.01, 0.06),
      p.range("lineMix", "Line Mix", 0, 1, 0.001, 0, 0, 0.6),
      p.range("speed", "Pulse Speed", -8, 8, 0.01, 0.35, -1, 1)
    ],
    emit: ({ input, out, param }) => `
let ${out("value")}_st = ${input("coord")} * ${param("scale")};
let ${out("value")}_cell = floor(${out("value")}_st);
let ${out("value")}_f = fract(${out("value")}_st);
let ${out("value")}_flip = hash21(${out("value")}_cell) > 0.5;
let ${out("value")}_tile = vec2f(select(${out("value")}_f.x, 1.0 - ${out("value")}_f.y, ${out("value")}_flip), select(${out("value")}_f.y, ${out("value")}_f.x, ${out("value")}_flip));
let ${out("value")}_arcDist = abs(min(length(${out("value")}_tile), length(${out("value")}_tile - vec2f(1.0))) - 0.5);
let ${out("value")}_lineDist = abs(${out("value")}_tile.x - ${out("value")}_tile.y);
let ${out("value")}_arcs = 1.0 - smoothstep(${param("width")}, ${param("width")} + ${param("softness")}, ${out("value")}_arcDist);
let ${out("value")}_lines = 1.0 - smoothstep(${param("width")}, ${param("width")} + ${param("softness")}, ${out("value")}_lineDist);
let ${out("value")}_pulse = 0.72 + 0.28 * sin((${out("value")}_tile.x + ${out("value")}_tile.y + ${input("time")} * ${param("speed")}) * 6.2831853);
let ${out("value")} = clamp(mix(${out("value")}_arcs, ${out("value")}_lines, ${param("lineMix")}) * ${out("value")}_pulse, 0.0, 1.0);`
  },
  metaballs: {
    type: "metaballs",
    label: "Metaballs",
    category: "Field",
    inputs: [...xyInput("coord"), input("time", "time", false, "frame.time")],
    outputs: [output("value", "value")],
    params: [
      p.range("scale", "Scale", 0.2, 12, 0.01, 2.4, 1, 5),
      p.range("blobs", "Blobs", 1, 5, 1, 4, 2, 5),
      p.range("radius", "Radius", 0.02, 2, 0.001, 0.22, 0.12, 0.55),
      p.range("threshold", "Threshold", 0.1, 8, 0.001, 1.45, 0.8, 3),
      p.range("softness", "Softness", 0.001, 2, 0.001, 0.35, 0.08, 0.8),
      p.range("speed", "Speed", -8, 8, 0.01, 0.35, -1, 1)
    ],
    emit: ({ input, out, param }) => `
let ${out("value")}_p = ${input("coord")} * ${param("scale")};
var ${out("value")}_field = 0.0;
for (var i = 0; i < 5; i = i + 1) {
  if (f32(i) < ${param("blobs")}) {
    let ${out("value")}_fi = f32(i);
    let ${out("value")}_center = vec2f(
      sin(${input("time")} * ${param("speed")} * (0.31 + ${out("value")}_fi * 0.13) + ${out("value")}_fi * 2.17),
      cos(${input("time")} * ${param("speed")} * (0.27 + ${out("value")}_fi * 0.11) + ${out("value")}_fi * 1.41)
    ) * 0.9;
    let ${out("value")}_d = length(${out("value")}_p - ${out("value")}_center);
    ${out("value")}_field = ${out("value")}_field + ${param("radius")} / (${out("value")}_d * ${out("value")}_d + 0.04);
  }
}
let ${out("value")} = smoothstep(${param("threshold")}, ${param("threshold")} + ${param("softness")}, ${out("value")}_field);`
  },
  topographic: {
    type: "topographic",
    label: "Topographic",
    category: "Field",
    inputs: [...xyInput("coord"), input("time", "time", false, "frame.time")],
    outputs: [output("value", "value")],
    params: [
      p.range("scale", "Scale", 0.1, 28, 0.01, 4.5, 1.2, 7.5),
      p.range("density", "Density", 1, 36, 0.01, 11, 4, 14),
      p.range("width", "Line Width", 0.005, 0.35, 0.001, 0.055, 0.025, 0.12),
      p.range("warp", "Warp", 0, 12, 0.01, 3.5, 0.8, 5),
      p.range("speed", "Drift", -4, 4, 0.01, 0.12, -0.2, 0.2)
    ],
    emit: ({ input, out, param }) => `
let ${out("value")}_p = ${input("coord")} * ${param("scale")} + vec2f(${input("time")} * ${param("speed")} * ${param("scale")}, -${input("time")} * ${param("speed")} * ${param("scale")} * 0.37);
var ${out("value")}_n = fbm2(${out("value")}_p, 5.0, 0.5, 2.02);
${out("value")}_n = ${out("value")}_n + sin(${out("value")}_n * ${param("warp")}) * 0.12;
let ${out("value")}_contour = abs(fract(${out("value")}_n * ${param("density")} + ${input("time")} * ${param("speed")} * 0.04) - 0.5);
let ${out("value")} = 1.0 - smoothstep(${param("width")}, ${param("width")} + 0.035, ${out("value")}_contour);`
  },
  cyberRain: {
    type: "cyberRain",
    label: "Cyber Rain",
    category: "Field",
    inputs: [...xyInput("coord"), input("time", "time", false, "frame.time")],
    outputs: [output("value", "value")],
    params: [
      p.range("columns", "Columns", 2, 80, 0.01, 22, 6, 26),
      p.range("speed", "Fall Speed", -24, 24, 0.01, 5, 1, 7),
      p.range("density", "Density", 0.01, 1, 0.001, 0.32, 0.12, 0.5),
      p.range("trail", "Trail", 0.1, 8, 0.001, 2.2, 1, 4),
      p.range("slant", "Slant", -2, 2, 0.001, 0.12, -0.35, 0.35)
    ],
    emit: ({ input, out, param }) => `
let ${out("value")}_st = vec2f((${input("coord")}.x + 2.0) * ${param("columns")} + ${input("coord")}.y * ${param("slant")} * ${param("columns")}, (${input("coord")}.y + 1.5) * ${param("columns")});
let ${out("value")}_col = floor(${out("value")}_st.x);
let ${out("value")}_colRand = hash21(vec2f(${out("value")}_col, 17.0));
let ${out("value")}_y = ${out("value")}_st.y + ${input("time")} * ${param("speed")} * (0.35 + ${out("value")}_colRand * 1.4);
let ${out("value")}_row = floor(${out("value")}_y);
let ${out("value")}_head = fract(${out("value")}_y);
let ${out("value")}_gate = step(1.0 - ${param("density")}, hash21(vec2f(${out("value")}_col, ${out("value")}_row)));
let ${out("value")}_tail = pow(1.0 - ${out("value")}_head, max(0.1, ${param("trail")}));
let ${out("value")} = ${out("value")}_gate * ${out("value")}_tail;`
  },
  circuitBoard: {
    type: "circuitBoard",
    label: "Circuit Board",
    category: "Field",
    inputs: [...xyInput("coord"), input("time", "time", false, "frame.time")],
    outputs: [output("value", "value")],
    params: [
      p.range("scale", "Scale", 1, 50, 0.01, 12, 4, 18),
      p.range("width", "Trace Width", 0.005, 0.28, 0.001, 0.055, 0.025, 0.11),
      p.range("pulse", "Pulse", 0, 4, 0.001, 1.4, 0.5, 2.5),
      p.range("speed", "Pulse Speed", -12, 12, 0.01, 1.6, -2.5, 2.5)
    ],
    emit: ({ input, out, param }) => `
let ${out("value")}_st = (${input("coord")} + vec2f(2.0)) * ${param("scale")};
let ${out("value")}_cell = floor(${out("value")}_st);
let ${out("value")}_f = fract(${out("value")}_st);
let ${out("value")}_rand = hash21(${out("value")}_cell);
let ${out("value")}_horizontal = ${out("value")}_rand > 0.5;
let ${out("value")}_d = select(abs(${out("value")}_f.x - 0.5), abs(${out("value")}_f.y - 0.5), ${out("value")}_horizontal);
let ${out("value")}_trace = 1.0 - smoothstep(${param("width")}, ${param("width")} + 0.035, ${out("value")}_d);
let ${out("value")}_along = select(${out("value")}_f.y, ${out("value")}_f.x, ${out("value")}_horizontal);
let ${out("value")}_pulseCenter = fract(${input("time")} * ${param("speed")} * (0.25 + hash21(${out("value")}_cell + vec2f(8.1, 3.7)) * 0.75) + ${out("value")}_rand);
let ${out("value")}_pulse = exp(-abs(${out("value")}_along - ${out("value")}_pulseCenter) * 18.0) * ${param("pulse")};
let ${out("value")}_pad = 1.0 - smoothstep(0.075, 0.13, length(${out("value")}_f - vec2f(0.5)));
let ${out("value")} = clamp(${out("value")}_trace * (0.18 + ${out("value")}_pulse) + ${out("value")}_pad * 0.35, 0.0, 1.0);`
  },
  quasicrystal: {
    type: "quasicrystal",
    label: "Quasicrystal",
    category: "Field",
    inputs: [...xyInput("coord"), input("time", "time", false, "frame.time"), input("phaseMod", "phase")],
    outputs: [output("value", "value")],
    params: [
      p.range("scale", "Scale", 0.1, 40, 0.01, 8, 2, 14),
      p.range("waves", "Waves", 3, 10, 1, 7, 5, 9),
      p.range("phase", "Phase", -6.28318, 6.28318, 0.001, 0, -1, 1),
      p.range("speed", "Drift", -4, 4, 0.01, 0.04, -0.08, 0.08),
      p.range("contrast", "Contrast", 0.1, 4, 0.001, 1.25, 0.8, 2.4)
    ],
    emit: ({ input, out, param }) => `
var ${out("value")}_sum = 0.0;
var ${out("value")}_count = 0.0;
for (var i = 0; i < 10; i = i + 1) {
  if (f32(i) < ${param("waves")}) {
    let ${out("value")}_a = f32(i) * 2.3999632 + ${param("phase")};
    let ${out("value")}_dir = vec2f(cos(${out("value")}_a), sin(${out("value")}_a));
    ${out("value")}_sum = ${out("value")}_sum + cos(dot(${input("coord")}, ${out("value")}_dir) * ${param("scale")} + ${input("time")} * ${param("speed")} * ${param("scale")} * (0.7 + f32(i) * 0.05) + ${input("phaseMod")});
    ${out("value")}_count = ${out("value")}_count + 1.0;
  }
}
let ${out("value")}_raw = ${out("value")}_sum / max(${out("value")}_count, 1.0);
let ${out("value")} = clamp(${out("value")}_raw * 0.5 * ${param("contrast")} + 0.5, 0.0, 1.0);`
  },
  moire: {
    type: "moire",
    label: "Moire",
    category: "Field",
    inputs: [...xyInput("coord"), input("time", "time", false, "frame.time"), input("phaseMod", "phase")],
    outputs: [output("value", "value")],
    params: [
      p.range("frequency", "Frequency A", 0.1, 60, 0.01, 11, 4, 18),
      p.range("offset", "Frequency Offset", -8, 8, 0.001, 0.45, -1.5, 1.5),
      p.range("angle", "Angle", -3.14159, 3.14159, 0.001, 0.2, -0.7, 0.7),
      p.range("speed", "Drift", -4, 4, 0.01, 0.035, -0.08, 0.08),
      p.range("contrast", "Contrast", 0.1, 6, 0.001, 1.6, 0.9, 3)
    ],
    emit: ({ input, out, param }) => `
let ${out("value")}_dirA = vec2f(cos(${param("angle")}), sin(${param("angle")}));
let ${out("value")}_dirB = vec2f(cos(${param("angle")} + 0.075), sin(${param("angle")} + 0.075));
let ${out("value")}_t = ${input("time")} * ${param("speed")} * ${param("frequency")} + ${input("phaseMod")};
let ${out("value")}_a = sin(dot(${input("coord")}, ${out("value")}_dirA) * ${param("frequency")} + ${out("value")}_t);
let ${out("value")}_b = sin(dot(${input("coord")}, ${out("value")}_dirB) * max(0.001, ${param("frequency")} + ${param("offset")}) - ${out("value")}_t * 0.91);
let ${out("value")} = clamp(abs(${out("value")}_a - ${out("value")}_b) * 0.5 * ${param("contrast")}, 0.0, 1.0);`
  },
  polarGrid: {
    type: "polarGrid",
    label: "Polar Grid",
    category: "Field",
    inputs: [...xyInput("coord"), ...xyInput("center", "center"), input("time", "time", false, "frame.time")],
    outputs: [output("value", "value")],
    params: [
      p.range("rings", "Rings", 0.5, 48, 0.01, 10, 4, 18),
      p.range("spokes", "Spokes", 1, 64, 1, 12, 6, 24),
      p.range("width", "Line Width", 0.002, 0.35, 0.001, 0.035, 0.015, 0.09),
      p.range("softness", "Softness", 0.001, 0.2, 0.001, 0.025, 0.01, 0.06),
      p.range("spin", "Spin", -1, 1, 0.001, 0.02, -0.04, 0.04)
    ],
    emit: ({ input, out, param }) => `
let ${out("value")}_p = ${input("coord")} - ${input("center")};
let ${out("value")}_r = length(${out("value")}_p);
let ${out("value")}_a = atan2(${out("value")}_p.y, ${out("value")}_p.x) / 6.2831853 + ${input("time")} * ${param("spin")};
let ${out("value")}_ring = abs(fract(${out("value")}_r * ${param("rings")}) - 0.5);
let ${out("value")}_spoke = abs(fract(${out("value")}_a * max(1.0, round(${param("spokes")}))) - 0.5);
let ${out("value")}_lines = min(${out("value")}_ring, ${out("value")}_spoke);
let ${out("value")} = 1.0 - smoothstep(${param("width")}, ${param("width")} + ${param("softness")}, ${out("value")}_lines);`
  },
  halftone: {
    type: "halftone",
    label: "Halftone",
    category: "Field",
    inputs: [...xyInput("coord"), input("value", "value", false, "0.5")],
    outputs: [output("value", "value")],
    params: [
      p.range("scale", "Scale", 1, 90, 0.01, 18, 8, 32),
      p.range("dotSize", "Dot Size", 0.02, 0.9, 0.001, 0.42, 0.22, 0.62),
      p.range("contrast", "Contrast", 0.1, 4, 0.001, 1, 0.6, 2),
      p.range("angle", "Angle", -3.14159, 3.14159, 0.001, 0.2, -0.7, 0.7)
    ],
    emit: ({ input, out, param }) => `
let ${out("value")}_st = rotate2(${input("coord")}, ${param("angle")}) * ${param("scale")};
let ${out("value")}_f = fract(${out("value")}_st) - vec2f(0.5);
let ${out("value")}_target = clamp((${input("value")} - 0.5) * ${param("contrast")} + 0.5, 0.0, 1.0);
let ${out("value")}_radius = ${param("dotSize")} * sqrt(${out("value")}_target);
let ${out("value")} = 1.0 - smoothstep(${out("value")}_radius, ${out("value")}_radius + 0.035, length(${out("value")}_f));`
  },
  sdfShape: {
    type: "sdfShape",
    label: "SDF Shape",
    category: "Field",
    inputs: [...xyInput("coord"), ...xyInput("center", "center"), input("time", "time", false, "frame.time")],
    outputs: [output("value", "value")],
    params: [
      p.select("shape", "Shape", [
        { label: "Circle", value: 0 },
        { label: "Box", value: 1 },
        { label: "Diamond", value: 2 },
        { label: "Hexagon", value: 3 },
        { label: "Star", value: 4 },
        { label: "Ring", value: 5 }
      ], 0),
      p.range("size", "Size", 0.02, 3, 0.001, 0.65, 0.25, 1.2),
      p.range("aspect", "Aspect", 0.1, 5, 0.001, 1, 0.6, 1.8),
      p.range("width", "Ring Width", 0.005, 1, 0.001, 0.12, 0.05, 0.25),
      p.range("softness", "Softness", 0.001, 0.5, 0.001, 0.035, 0.015, 0.08),
      p.range("angle", "Angle", -3.14159, 3.14159, 0.001, 0, -0.35, 0.35),
      p.range("spin", "Spin", -1, 1, 0.001, 0, -0.03, 0.03)
    ],
    emit: ({ input, out, param }) => `
let ${out("value")}_p = rotate2(${input("coord")} - ${input("center")}, ${param("angle")} + ${input("time")} * ${param("spin")});
let ${out("value")}_shape = i32(round(${param("shape")}));
var ${out("value")}_d = length(${out("value")}_p) - ${param("size")};
if (${out("value")}_shape == 1) {
  ${out("value")}_d = sdBox2(${out("value")}_p, vec2f(${param("size")} * ${param("aspect")}, ${param("size")}));
}
if (${out("value")}_shape == 2) {
  ${out("value")}_d = (abs(${out("value")}_p.x) / max(${param("aspect")}, 0.001) + abs(${out("value")}_p.y)) - ${param("size")};
}
if (${out("value")}_shape == 3) {
  let ${out("value")}_q = abs(${out("value")}_p);
  ${out("value")}_d = max(${out("value")}_q.x * 0.8660254 + ${out("value")}_q.y * 0.5, ${out("value")}_q.y) - ${param("size")};
}
if (${out("value")}_shape == 4) {
  let ${out("value")}_a = atan2(${out("value")}_p.y, ${out("value")}_p.x);
  let ${out("value")}_target = ${param("size")} * (0.72 + 0.28 * cos(${out("value")}_a * 5.0));
  ${out("value")}_d = length(${out("value")}_p) - ${out("value")}_target;
}
if (${out("value")}_shape == 5) {
  ${out("value")}_d = abs(length(${out("value")}_p) - ${param("size")}) - ${param("width")};
}
let ${out("value")} = 1.0 - smoothstep(0.0, ${param("softness")}, ${out("value")}_d);`
  },
  juliaFractal: {
    type: "juliaFractal",
    label: "Julia Fractal",
    category: "Field",
    inputs: [...xyInput("coord"), input("time", "time", false, "frame.time")],
    outputs: [output("value", "value")],
    params: [
      p.range("zoom", "Zoom", 0.1, 6, 0.001, 1.45, 0.8, 2.4),
      p.range("cX", "C X", -1.5, 1.5, 0.001, -0.72, -0.84, -0.55),
      p.range("cY", "C Y", -1.5, 1.5, 0.001, 0.24, 0.12, 0.36),
      p.range("iterations", "Iterations", 8, 64, 1, 36, 20, 48),
      p.range("bailout", "Bailout", 2, 8, 0.001, 4, 3, 5),
      p.range("speed", "Drift", -2, 2, 0.001, 0.015, -0.04, 0.04)
    ],
    emit: ({ input, out, param }) => `
var ${out("value")}_z = ${input("coord")} * ${param("zoom")};
let ${out("value")}_c = vec2f(${param("cX")} + sin(${input("time")} * ${param("speed")}) * 0.08, ${param("cY")} + cos(${input("time")} * ${param("speed")} * 0.83) * 0.08);
var ${out("value")}_escape = 0.0;
var ${out("value")}_active = true;
for (var i = 0; i < 64; i = i + 1) {
  if (f32(i) < ${param("iterations")} && ${out("value")}_active) {
    ${out("value")}_z = vec2f(${out("value")}_z.x * ${out("value")}_z.x - ${out("value")}_z.y * ${out("value")}_z.y, 2.0 * ${out("value")}_z.x * ${out("value")}_z.y) + ${out("value")}_c;
    if (dot(${out("value")}_z, ${out("value")}_z) > ${param("bailout")} * ${param("bailout")}) {
      ${out("value")}_escape = f32(i) / max(${param("iterations")}, 1.0);
      ${out("value")}_active = false;
    }
  }
}
let ${out("value")} = select(${out("value")}_escape, 1.0, ${out("value")}_active);`
  },
  lightning: {
    type: "lightning",
    label: "Lightning",
    category: "Field",
    inputs: [...xyInput("coord"), input("time", "time", false, "frame.time")],
    outputs: [output("value", "value")],
    params: [
      p.range("scale", "Scale", 0.5, 24, 0.01, 5, 2, 9),
      p.range("width", "Width", 0.002, 0.5, 0.001, 0.045, 0.018, 0.09),
      p.range("branches", "Branches", 0, 1, 0.001, 0.35, 0.15, 0.7),
      p.range("jitter", "Jitter", 0, 2, 0.001, 0.55, 0.25, 0.9),
      p.range("speed", "Flicker", 0, 18, 0.001, 0.08, 0.03, 0.1)
    ],
    emit: ({ input, out, param }) => `
let ${out("value")}_p = ${input("coord")} * ${param("scale")};
let ${out("value")}_t = floor(${input("time")} * max(${param("speed")}, 0.001) * 24.0);
let ${out("value")}_center = (noise2(vec2f(${out("value")}_p.y * 0.8, ${out("value")}_t)) - 0.5) * ${param("jitter")};
let ${out("value")}_branch = sin(${out("value")}_p.y * 7.0 + hash21(vec2f(${out("value")}_t, 3.1)) * 6.2831853) * ${param("branches")} * 0.18;
let ${out("value")}_d = abs(${out("value")}_p.x - ${out("value")}_center - ${out("value")}_branch);
let ${out("value")}_core = 1.0 - smoothstep(${param("width")} * ${param("scale")}, (${param("width")} + 0.045) * ${param("scale")}, ${out("value")}_d);
let ${out("value")}_flicker = 0.55 + hash21(vec2f(${out("value")}_t, floor(${out("value")}_p.y))) * 0.45;
let ${out("value")} = clamp(${out("value")}_core * ${out("value")}_flicker, 0.0, 1.0);`
  },
  starfield: {
    type: "starfield",
    label: "Starfield",
    category: "Field",
    inputs: [...xyInput("coord"), input("time", "time", false, "frame.time")],
    outputs: [output("value", "value")],
    params: [
      p.range("scale", "Scale", 2, 90, 0.01, 28, 12, 46),
      p.range("density", "Density", 0.01, 1, 0.001, 0.22, 0.08, 0.4),
      p.range("size", "Size", 0.005, 0.3, 0.001, 0.055, 0.025, 0.1),
      p.range("streak", "Streak", 0, 1, 0.001, 0.3, 0, 0.7),
      p.range("speed", "Warp Speed", -8, 8, 0.001, 0.06, 0.01, 0.1)
    ],
    emit: ({ input, out, param }) => `
let ${out("value")}_p = ${input("coord")} * ${param("scale")} * (1.0 + ${input("time")} * ${param("speed")} * 0.15);
let ${out("value")}_cell = floor(${out("value")}_p);
let ${out("value")}_f = fract(${out("value")}_p) - vec2f(0.5);
let ${out("value")}_gate = step(1.0 - ${param("density")}, hash21(${out("value")}_cell));
let ${out("value")}_center = hash22(${out("value")}_cell) - vec2f(0.5);
let ${out("value")}_d = length((${out("value")}_f - ${out("value")}_center) * vec2f(1.0, max(0.12, 1.0 - ${param("streak")})));
let ${out("value")}_blink = 0.45 + 0.55 * sin(${input("time")} * 3.0 + hash21(${out("value")}_cell + vec2f(2.0)) * 6.2831853);
let ${out("value")} = ${out("value")}_gate * (1.0 - smoothstep(${param("size")}, ${param("size")} + 0.035, ${out("value")}_d)) * ${out("value")}_blink;`
  },
  woodGrain: {
    type: "woodGrain",
    label: "Wood Grain",
    category: "Field",
    inputs: [...xyInput("coord"), input("time", "time", false, "frame.time")],
    outputs: [output("value", "value")],
    params: [
      p.range("scale", "Scale", 0.1, 24, 0.01, 4.2, 1.2, 7),
      p.range("rings", "Rings", 1, 60, 0.01, 18, 8, 28),
      p.range("warp", "Warp", 0, 8, 0.001, 2.2, 0.8, 3.8),
      p.range("contrast", "Contrast", 0.1, 4, 0.001, 1.35, 0.8, 2.4),
      p.range("speed", "Drift", -3, 3, 0.001, 0.025, -0.05, 0.05)
    ],
    emit: ({ input, out, param }) => `
let ${out("value")}_p = ${input("coord")} * ${param("scale")} + vec2f(${input("time")} * ${param("speed")}, 0.0);
let ${out("value")}_n = fbm2(${out("value")}_p, 5.0, 0.52, 2.01) * ${param("warp")};
let ${out("value")}_r = length(${out("value")}_p + ${out("value")}_n);
let ${out("value")}_raw = sin(${out("value")}_r * ${param("rings")} + ${out("value")}_n);
let ${out("value")} = clamp(${out("value")}_raw * 0.5 * ${param("contrast")} + 0.5, 0.0, 1.0);`
  },
  marble: {
    type: "marble",
    label: "Marble",
    category: "Field",
    inputs: [...xyInput("coord"), input("time", "time", false, "frame.time")],
    outputs: [output("value", "value")],
    params: [
      p.range("scale", "Scale", 0.1, 28, 0.01, 4.5, 1.2, 7.5),
      p.range("bands", "Bands", 1, 60, 0.01, 12, 5, 22),
      p.range("warp", "Warp", 0, 10, 0.001, 3.2, 1, 5),
      p.range("angle", "Angle", -3.14159, 3.14159, 0.001, 0.4, -0.8, 0.8),
      p.range("speed", "Drift", -3, 3, 0.001, 0.025, -0.05, 0.05)
    ],
    emit: ({ input, out, param }) => `
let ${out("value")}_p = rotate2(${input("coord")}, ${param("angle")}) * ${param("scale")} + vec2f(${input("time")} * ${param("speed")}, 0.0);
let ${out("value")}_n = fbm2(${out("value")}_p, 5.0, 0.5, 2.05) * ${param("warp")};
let ${out("value")} = sin((${out("value")}_p.x + ${out("value")}_n) * ${param("bands")}) * 0.5 + 0.5;`
  },
  iris: {
    type: "iris",
    label: "Iris",
    category: "Field",
    inputs: [...xyInput("coord"), ...xyInput("center", "center"), input("time", "time", false, "frame.time")],
    outputs: [output("value", "value")],
    params: [
      p.range("blades", "Blades", 3, 18, 1, 7, 5, 10),
      p.range("radius", "Radius", 0.05, 3, 0.001, 0.7, 0.35, 1.2),
      p.range("depth", "Blade Depth", 0, 0.9, 0.001, 0.35, 0.15, 0.55),
      p.range("softness", "Softness", 0.001, 0.5, 0.001, 0.04, 0.02, 0.09),
      p.range("spin", "Spin", -1, 1, 0.001, 0.02, -0.04, 0.04)
    ],
    emit: ({ input, out, param }) => `
let ${out("value")}_p = ${input("coord")} - ${input("center")};
let ${out("value")}_r = length(${out("value")}_p);
let ${out("value")}_a = atan2(${out("value")}_p.y, ${out("value")}_p.x) + ${input("time")} * ${param("spin")};
let ${out("value")}_edge = ${param("radius")} * (1.0 + cos(${out("value")}_a * round(${param("blades")})) * ${param("depth")});
let ${out("value")} = 1.0 - smoothstep(${out("value")}_edge, ${out("value")}_edge + ${param("softness")}, ${out("value")}_r);`
  },
  roseCurve: {
    type: "roseCurve",
    label: "Rose Curve",
    category: "Field",
    inputs: [...xyInput("coord"), ...xyInput("center", "center"), input("time", "time", false, "frame.time")],
    outputs: [output("value", "value")],
    params: [
      p.range("petals", "Petals", 2, 18, 1, 5, 3, 9),
      p.range("radius", "Radius", 0.05, 3, 0.001, 0.9, 0.4, 1.4),
      p.range("width", "Line Width", 0.005, 0.5, 0.001, 0.055, 0.025, 0.11),
      p.range("twist", "Twist", -12, 12, 0.001, 0, -2, 2),
      p.range("spin", "Spin", -1, 1, 0.001, 0.025, -0.05, 0.05)
    ],
    emit: ({ input, out, param }) => `
let ${out("value")}_p = ${input("coord")} - ${input("center")};
let ${out("value")}_r = length(${out("value")}_p);
let ${out("value")}_a = atan2(${out("value")}_p.y, ${out("value")}_p.x) + ${input("time")} * ${param("spin")};
let ${out("value")}_target = abs(cos(${out("value")}_a * round(${param("petals")}))) * ${param("radius")};
let ${out("value")}_d = abs(${out("value")}_r - ${out("value")}_target + sin(${out("value")}_r * ${param("twist")}) * 0.04);
let ${out("value")} = 1.0 - smoothstep(${param("width")}, ${param("width")} + 0.04, ${out("value")}_d);`
  },
  crtScanlines: {
    type: "crtScanlines",
    label: "CRT Scanlines",
    category: "Field",
    inputs: [...xyInput("coord"), input("time", "time", false, "frame.time")],
    outputs: [output("value", "value")],
    params: [
      p.range("density", "Density", 20, 800, 1, 180, 90, 280),
      p.range("strength", "Strength", 0, 1, 0.001, 0.42, 0.18, 0.65),
      p.range("vignette", "Vignette", 0, 2, 0.001, 0.6, 0.2, 1),
      p.range("flicker", "Flicker", 0, 1, 0.001, 0.12, 0, 0.25),
      p.range("speed", "Roll", -3, 3, 0.001, 0.015, -0.04, 0.04)
    ],
    emit: ({ input, out, param }) => `
let ${out("value")}_line = sin((${input("coord")}.y + ${input("time")} * ${param("speed")}) * ${param("density")}) * 0.5 + 0.5;
let ${out("value")}_scan = mix(1.0, ${out("value")}_line, ${param("strength")});
let ${out("value")}_vig = 1.0 - smoothstep(0.35, 1.6, length(${input("coord")}) * ${param("vignette")});
let ${out("value")}_flicker = 1.0 - hash21(vec2f(floor(${input("time")} * 30.0), 7.1)) * ${param("flicker")};
let ${out("value")} = clamp(${out("value")}_scan * mix(1.0, ${out("value")}_vig, ${param("vignette")} * 0.5) * ${out("value")}_flicker, 0.0, 1.0);`
  },
  kaleidoscope: {
    type: "kaleidoscope",
    label: "Kaleidoscope",
    category: "Domain",
    inputs: [...xyInput("coord"), input("segmentsMod", "segments"), input("time", "time", false, "frame.time")],
    outputs: [...xyOutput("coord")],
    params: [
      p.range("segments", "Segments", 2, 24, 1, 6, 3, 12),
      p.range("angle", "Angle", -3.14159, 3.14159, 0.001, 0, -0.35, 0.35),
      p.range("spin", "Spin", -1, 1, 0.001, 0.02, -0.04, 0.04)
    ],
    emit: ({ input, out, param }) => `
let ${out("coord")}_segments = max(2.0, round(${param("segments")} + ${input("segmentsMod")}));
let ${out("coord")}_p = rotate2(${input("coord")}, ${param("angle")} + ${input("time")} * ${param("spin")});
let ${out("coord")}_r = length(${out("coord")}_p);
let ${out("coord")}_theta = atan2(${out("coord")}_p.y, ${out("coord")}_p.x);
let ${out("coord")}_period = 6.2831853 / ${out("coord")}_segments;
let ${out("coord")}_folded = abs((${out("coord")}_theta - floor(${out("coord")}_theta / ${out("coord")}_period) * ${out("coord")}_period) - ${out("coord")}_period * 0.5) * ${out("coord")}_segments;
let ${out("coord")} = vec2f(cos(${out("coord")}_folded), sin(${out("coord")}_folded)) * ${out("coord")}_r;`
  },
  repeatDomain: {
    type: "repeatDomain",
    label: "Repeat",
    category: "Domain",
    inputs: [...xyInput("coord"), input("time", "time", false, "frame.time")],
    outputs: [...xyOutput("coord")],
    params: [
      p.range("scale", "Scale", 0.2, 40, 0.01, 4, 1.5, 8),
      p.range("offsetX", "Offset X", -4, 4, 0.001, 0, -0.25, 0.25),
      p.range("offsetY", "Offset Y", -4, 4, 0.001, 0, -0.25, 0.25),
      p.range("angle", "Angle", -3.14159, 3.14159, 0.001, 0, -0.35, 0.35),
      p.range("spin", "Spin", -1, 1, 0.001, 0, -0.03, 0.03),
      p.toggle("mirror", "Mirror", false)
    ],
    emit: ({ input, out, param }) => `
let ${out("coord")}_scaled = rotate2(${input("coord")}, ${param("angle")} + ${input("time")} * ${param("spin")}) * max(${param("scale")}, 0.001) + vec2f(${param("offsetX")}, ${param("offsetY")});
let ${out("coord")}_wrapped = fract(${out("coord")}_scaled) - vec2f(0.5);
let ${out("coord")}_mirrored = abs(fract(${out("coord")}_scaled * 0.5) * 2.0 - vec2f(1.0)) - vec2f(0.5);
var ${out("coord")}_next = ${out("coord")}_wrapped;
if (${param("mirror")} > 0.5) {
  ${out("coord")}_next = ${out("coord")}_mirrored;
}
let ${out("coord")} = ${out("coord")}_next;`
  },
  polarDomain: {
    type: "polarDomain",
    label: "Polar Domain",
    category: "Domain",
    inputs: [...xyInput("coord"), ...xyInput("center", "center"), input("time", "time", false, "frame.time")],
    outputs: [...xyOutput("coord")],
    params: [
      p.range("angleScale", "Angle Scale", 0.1, 24, 0.001, 1, 0.8, 6),
      p.range("radiusScale", "Radius Scale", 0.1, 24, 0.001, 2.5, 1, 6),
      p.range("radiusPower", "Radius Power", 0.1, 4, 0.001, 1, 0.65, 1.6),
      p.range("angleOffset", "Angle Offset", -2, 2, 0.001, 0, -0.25, 0.25),
      p.range("spin", "Spin", -1, 1, 0.001, 0.02, -0.04, 0.04),
      p.range("scrollSpeed", "Scroll", -2, 2, 0.001, 0.02, -0.04, 0.04)
    ],
    emit: ({ input, out, param }) => `
let ${out("coord")}_p = ${input("coord")} - ${input("center")};
let ${out("coord")}_r = pow(max(length(${out("coord")}_p), 0.0001), max(${param("radiusPower")}, 0.0001));
let ${out("coord")}_a = atan2(${out("coord")}_p.y, ${out("coord")}_p.x) / 6.2831853;
let ${out("coord")} = vec2f(${out("coord")}_a * ${param("angleScale")} + ${param("angleOffset")} + ${input("time")} * ${param("spin")}, ${out("coord")}_r * ${param("radiusScale")} - ${input("time")} * ${param("scrollSpeed")});`
  },
  pinchBulge: {
    type: "pinchBulge",
    label: "Pinch Bulge",
    category: "Domain",
    inputs: [...xyInput("coord"), ...xyInput("center", "center"), input("amountMod", "amount")],
    outputs: [...xyOutput("coord")],
    params: [
      p.range("amount", "Amount", -2, 2, 0.001, 0.35, -0.7, 0.7),
      p.range("radius", "Radius", 0.05, 8, 0.001, 1.3, 0.5, 2.2)
    ],
    emit: ({ input, out, param }) => `
let ${out("coord")}_p = ${input("coord")} - ${input("center")};
let ${out("coord")}_falloff = clamp(1.0 - length(${out("coord")}_p) / max(${param("radius")}, 0.0001), 0.0, 1.0);
let ${out("coord")}_factor = max(0.05, 1.0 + (${param("amount")} + ${input("amountMod")}) * ${out("coord")}_falloff * ${out("coord")}_falloff);
let ${out("coord")} = ${input("center")} + ${out("coord")}_p * ${out("coord")}_factor;`
  },
  waveWarp: {
    type: "waveWarp",
    label: "Wave Warp",
    category: "Domain",
    inputs: [...xyInput("coord"), input("amountMod", "amount"), input("time", "time", false, "frame.time")],
    outputs: [...xyOutput("coord")],
    params: [
      p.range("frequency", "Frequency", 0.05, 40, 0.01, 6, 1.5, 12),
      p.range("amount", "Amount", -2, 2, 0.001, 0.18, -0.35, 0.35),
      p.range("angle", "Angle", -3.14159, 3.14159, 0.001, 0, -0.7, 0.7),
      p.range("phase", "Phase", -6.28318, 6.28318, 0.001, 0, -1, 1),
      p.range("speed", "Drift", -3, 3, 0.001, 0.035, -0.07, 0.07)
    ],
    emit: ({ input, out, param }) => `
let ${out("coord")}_dir = vec2f(cos(${param("angle")}), sin(${param("angle")}));
let ${out("coord")}_normal = vec2f(-${out("coord")}_dir.y, ${out("coord")}_dir.x);
let ${out("coord")}_wave = sin(dot(${input("coord")}, ${out("coord")}_dir) * ${param("frequency")} + ${input("time")} * ${param("speed")} * ${param("frequency")} + ${param("phase")});
let ${out("coord")} = ${input("coord")} + ${out("coord")}_normal * ${out("coord")}_wave * (${param("amount")} + ${input("amountMod")});`
  },
  foldDomain: {
    type: "foldDomain",
    label: "Fold",
    category: "Domain",
    inputs: [...xyInput("coord"), input("time", "time", false, "frame.time")],
    outputs: [...xyOutput("coord")],
    params: [
      p.range("folds", "Folds", 1, 6, 1, 3, 2, 5),
      p.range("offset", "Offset", 0.02, 3, 0.001, 0.75, 0.35, 1.2),
      p.range("scale", "Scale", 0.1, 8, 0.001, 1, 0.7, 2.2),
      p.range("angle", "Angle", -3.14159, 3.14159, 0.001, 0.15, -0.45, 0.45),
      p.range("spin", "Spin", -1, 1, 0.001, 0, -0.03, 0.03)
    ],
    emit: ({ input, out, param }) => `
var ${out("coord")}_p = rotate2(${input("coord")} * ${param("scale")}, ${param("angle")} + ${input("time")} * ${param("spin")});
for (var i = 0; i < 6; i = i + 1) {
  if (f32(i) < ${param("folds")}) {
    ${out("coord")}_p = abs(${out("coord")}_p) - vec2f(${param("offset")});
    ${out("coord")}_p = rotate2(${out("coord")}_p, 0.7853982 + f32(i) * 0.17);
  }
}
let ${out("coord")} = ${out("coord")}_p / max(${param("scale")}, 0.0001);`
  },
  glitchWarp: {
    type: "glitchWarp",
    label: "Glitch Warp",
    category: "Domain",
    inputs: [...xyInput("coord"), input("amountMod", "amount"), input("time", "time", false, "frame.time")],
    outputs: [...xyOutput("coord")],
    params: [
      p.range("bands", "Bands", 1, 90, 0.01, 18, 6, 28),
      p.range("amount", "Amount", -2, 2, 0.001, 0.12, -0.3, 0.3),
      p.range("threshold", "Threshold", 0, 1, 0.001, 0.62, 0.35, 0.82),
      p.range("speed", "Step Speed", 0, 16, 0.001, 0.08, 0.03, 0.1)
    ],
    emit: ({ input, out, param }) => `
let ${out("coord")}_band = floor(${input("coord")}.y * ${param("bands")});
let ${out("coord")}_frame = floor(${input("time")} * max(${param("speed")}, 0.001) * 24.0);
let ${out("coord")}_gate = step(${param("threshold")}, hash21(vec2f(${out("coord")}_band, ${out("coord")}_frame)));
let ${out("coord")}_shift = (hash21(vec2f(${out("coord")}_band, ${out("coord")}_frame + 7.0)) * 2.0 - 1.0) * (${param("amount")} + ${input("amountMod")}) * ${out("coord")}_gate;
let ${out("coord")} = ${input("coord")} + vec2f(${out("coord")}_shift, 0.0);`
  },
  translate: {
    type: "translate",
    label: "Translate",
    category: "Domain",
    inputs: [...xyInput("coord"), ...xyInput("amount"), input("time", "time", false, "frame.time")],
    outputs: [...xyOutput("coord")],
    params: [
      p.range("x", "X", -8, 8, 0.001, 0, -0.25, 0.25),
      p.range("y", "Y", -8, 8, 0.001, 0, -0.25, 0.25),
      p.range("speedX", "Speed X", -4, 4, 0.001, 0, -0.025, 0.025),
      p.range("speedY", "Speed Y", -4, 4, 0.001, 0, -0.025, 0.025)
    ],
    emit: ({ input, out, param }) => `let ${out("coord")} = ${input("coord")} + vec2f(${param("x")}, ${param("y")}) + vec2f(${param("speedX")}, ${param("speedY")}) * ${input("time")} + ${input("amount")};`
  },
  scale: {
    type: "scale",
    label: "Scale",
    category: "Domain",
    inputs: [...xyInput("coord"), input("factor", "factor"), input("time", "time", false, "frame.time")],
    outputs: [...xyOutput("coord")],
    params: [
      p.range("scale", "Scale", 0.05, 20, 0.001, 1.15, 0.8, 1.6),
      p.range("pulse", "Pulse", 0, 4, 0.001, 0, 0, 0.25),
      p.range("speed", "Speed", -6, 6, 0.001, 0, -0.04, 0.04)
    ],
    emit: ({ input, out, param }) => `
let ${out("coord")}_pulse = sin(${input("time")} * ${param("speed")}) * ${param("pulse")};
let ${out("coord")} = ${input("coord")} * max(0.0001, ${param("scale")} + ${input("factor")} + ${out("coord")}_pulse);`
  },
  rotate: {
    type: "rotate",
    label: "Rotate",
    category: "Domain",
    inputs: [...xyInput("coord"), input("angleMod", "angle"), input("time", "time", false, "frame.time")],
    outputs: [...xyOutput("coord")],
    params: [p.range("angle", "Angle", -6.28318, 6.28318, 0.001, 0.2, -0.35, 0.35), p.range("speed", "Speed", -8, 8, 0.001, 0, -0.03, 0.03)],
    emit: ({ input, out, param }) => `
let ${out("coord")}_a = ${param("angle")} + ${input("angleMod")} + ${input("time")} * ${param("speed")};
let ${out("coord")} = rotate2(${input("coord")}, ${out("coord")}_a);`
  },
  swirl: {
    type: "swirl",
    label: "Swirl",
    category: "Domain",
    inputs: [...xyInput("coord"), input("mod", "mod"), input("time", "time", false, "frame.time")],
    outputs: [...xyOutput("coord")],
    params: [
      p.range("strength", "Strength", -24, 24, 0.01, 1.8, -1.5, 1.5),
      p.range("radius", "Radius", 0.05, 8, 0.01, 2, 0.7, 2.8),
      p.range("speed", "Speed", -8, 8, 0.001, 0, -0.03, 0.03)
    ],
    emit: ({ input, out, param }) => `
let ${out("coord")}_r = length(${input("coord")});
let ${out("coord")}_a = (${param("strength")} + ${input("mod")} + ${input("time")} * ${param("speed")}) * exp(-${out("coord")}_r / max(${param("radius")}, 0.001));
let ${out("coord")} = rotate2(${input("coord")}, ${out("coord")}_a);`
  },
  mirror: {
    type: "mirror",
    label: "Mirror",
    category: "Domain",
    inputs: [...xyInput("coord")],
    outputs: [...xyOutput("coord")],
    params: [p.toggle("x", "Mirror X", true), p.toggle("y", "Mirror Y", false)],
    emit: ({ input, out, param }) => `
let ${out("coord")}_mx = select(${input("coord")}.x, abs(${input("coord")}.x), ${param("x")} > 0.5);
let ${out("coord")}_my = select(${input("coord")}.y, abs(${input("coord")}.y), ${param("y")} > 0.5);
let ${out("coord")} = vec2f(${out("coord")}_mx, ${out("coord")}_my);`
  },
  domainWarp: {
    type: "domainWarp",
    label: "Domain Warp",
    category: "Domain",
    inputs: [...xyInput("coord"), input("amountMod", "amount"), input("time", "time", false, "frame.time"), input("scaleMod", "scale")],
    outputs: [...xyOutput("coord")],
    params: [
      p.range("scale", "Scale", 0.05, 24, 0.01, 3.5, 0.7, 6.5),
      p.range("amount", "Amount", -4, 4, 0.001, 0.28, -0.35, 0.35),
      p.range("speed", "Speed", -3, 3, 0.01, 0.035, -0.07, 0.07)
    ],
    emit: ({ input, out, param }) => `
let ${out("coord")}_scale = max(0.001, ${param("scale")} + ${input("scaleMod")});
let ${out("coord")}_p = ${input("coord")} * ${out("coord")}_scale + vec2f(${input("time")} * ${param("speed")} * ${out("coord")}_scale, 0.0);
let ${out("coord")}_w = vec2f(noise2(${out("coord")}_p), noise2(${out("coord")}_p + vec2f(31.7, 12.9))) * 2.0 - vec2f(1.0);
let ${out("coord")} = ${input("coord")} + ${out("coord")}_w * (${param("amount")} + ${input("amountMod")});`
  },
  add: {
    type: "add",
    label: "Add",
    category: "Math",
    inputs: [input("a", "a"), input("b", "b")],
    outputs: [output("value", "value")],
    params: [],
    emit: ({ input, out }) => `let ${out("value")} = ${input("a")} + ${input("b")};`
  },
  multiply: {
    type: "multiply",
    label: "Multiply",
    category: "Math",
    inputs: [input("a", "a"), input("b", "b", false, "1.0")],
    outputs: [output("value", "value")],
    params: [p.range("gain", "Gain", -4, 4, 0.001, 1, -2, 2)],
    emit: ({ input, out, param }) => `let ${out("value")} = ${input("a")} * ${input("b")} * ${param("gain")};`
  },
  mix: {
    type: "mix",
    label: "Mix",
    category: "Math",
    inputs: [input("a", "a"), input("b", "b"), input("factor", "factor")],
    outputs: [output("value", "value")],
    params: [p.range("factor", "Factor", 0, 1, 0.001, 0.5, 0, 1)],
    emit: ({ input, out, param }) => `let ${out("value")} = mix(${input("a")}, ${input("b")}, clamp(${param("factor")} + ${input("factor")}, 0.0, 1.0));`
  },
  min: {
    type: "min",
    label: "Min",
    category: "Math",
    inputs: [input("a", "a"), input("b", "b")],
    outputs: [output("value", "value")],
    params: [],
    emit: ({ input, out }) => `let ${out("value")} = min(${input("a")}, ${input("b")});`
  },
  max: {
    type: "max",
    label: "Max",
    category: "Math",
    inputs: [input("a", "a"), input("b", "b")],
    outputs: [output("value", "value")],
    params: [],
    emit: ({ input, out }) => `let ${out("value")} = max(${input("a")}, ${input("b")});`
  },
  abs: {
    type: "abs",
    label: "Abs",
    category: "Math",
    inputs: [input("value", "value")],
    outputs: [output("value", "value")],
    params: [],
    emit: ({ input, out }) => `let ${out("value")} = abs(${input("value")});`
  },
  clamp: {
    type: "clamp",
    label: "Clamp",
    category: "Math",
    inputs: [input("value", "value")],
    outputs: [output("value", "value")],
    params: [p.range("min", "Min", -4, 4, 0.001, 0, -1, 0.4), p.range("max", "Max", -4, 4, 0.001, 1, 0.6, 2)],
    emit: ({ input, out, param }) => `let ${out("value")} = clamp(${input("value")}, min(${param("min")}, ${param("max")}), max(${param("min")}, ${param("max")}));`
  },
  smoothstep: {
    type: "smoothstep",
    label: "Smoothstep",
    category: "Math",
    inputs: [input("value", "value")],
    outputs: [output("value", "value")],
    params: [p.range("edge0", "Edge 0", -2, 2, 0.001, 0.2, -0.5, 0.5), p.range("edge1", "Edge 1", -2, 2, 0.001, 0.8, 0.4, 1.5)],
    emit: ({ input, out, param }) => `let ${out("value")} = smoothstep(min(${param("edge0")}, ${param("edge1")}), max(${param("edge0")}, ${param("edge1")}), ${input("value")});`
  },
  threshold: {
    type: "threshold",
    label: "Threshold",
    category: "Math",
    inputs: [input("value", "value"), input("thresholdMod", "threshold"), input("softnessMod", "softness")],
    outputs: [output("value", "value")],
    params: [p.range("threshold", "Threshold", -2, 2, 0.001, 0.5, 0.1, 0.9), p.range("softness", "Softness", 0, 1, 0.001, 0.05, 0, 0.2)],
    emit: ({ input, out, param }) => `
let ${out("value")}_threshold = ${param("threshold")} + ${input("thresholdMod")};
let ${out("value")}_softness = max(0.0001, ${param("softness")} + ${input("softnessMod")});
let ${out("value")} = smoothstep(${out("value")}_threshold - ${out("value")}_softness, ${out("value")}_threshold + ${out("value")}_softness, ${input("value")});`
  },
  remap: {
    type: "remap",
    label: "Remap",
    category: "Math",
    inputs: [input("value", "value")],
    outputs: [output("value", "value")],
    params: [
      p.range("inMin", "In Min", -4, 4, 0.001, 0, -1, 0.2),
      p.range("inMax", "In Max", -4, 4, 0.001, 1, 0.5, 2),
      p.range("outMin", "Out Min", -4, 4, 0.001, 0, -1, 0.2),
      p.range("outMax", "Out Max", -4, 4, 0.001, 1, 0.5, 2)
    ],
    emit: ({ input, out, param }) => `
let ${out("value")}_t = (${input("value")} - ${param("inMin")}) / max(abs(${param("inMax")} - ${param("inMin")}), 0.0001);
let ${out("value")} = mix(${param("outMin")}, ${param("outMax")}, ${out("value")}_t);`
  },
  invert: {
    type: "invert",
    label: "Invert",
    category: "Math",
    inputs: [input("value", "value")],
    outputs: [output("value", "value")],
    params: [],
    emit: ({ input, out }) => `let ${out("value")} = 1.0 - ${input("value")};`
  },
  powerCurve: {
    type: "powerCurve",
    label: "Power Curve",
    category: "Math",
    inputs: [input("value", "value")],
    outputs: [output("value", "value")],
    params: [p.range("power", "Power", 0.05, 8, 0.001, 1.4, 0.5, 3), p.range("gain", "Gain", 0, 4, 0.001, 1, 0.7, 1.5)],
    emit: ({ input, out, param }) => `let ${out("value")} = pow(max(${input("value")} * ${param("gain")}, 0.0), max(${param("power")}, 0.0001));`
  },
  biasGain: {
    type: "biasGain",
    label: "Bias Gain",
    category: "Math",
    inputs: [input("value", "value"), input("biasMod", "bias"), input("gainMod", "gain")],
    outputs: [output("value", "value")],
    params: [p.range("bias", "Bias", 0.001, 0.999, 0.001, 0.5, 0.25, 0.75), p.range("gain", "Gain", 0.001, 0.999, 0.001, 0.5, 0.25, 0.75)],
    emit: ({ input, out, param }) => `
let ${out("value")}_biased = biasValue(${input("value")}, clamp(${param("bias")} + ${input("biasMod")}, 0.001, 0.999));
let ${out("value")} = gainValue(${out("value")}_biased, clamp(${param("gain")} + ${input("gainMod")}, 0.001, 0.999));`
  },
  sineMath: {
    type: "sineMath",
    label: "Sine Math",
    category: "Math",
    inputs: [input("value", "value"), input("phaseMod", "phase")],
    outputs: [output("value", "value")],
    params: [p.range("frequency", "Frequency", 0.01, 80, 0.001, 1, 0.5, 8), p.range("phase", "Phase", -6.28318, 6.28318, 0.001, 0, -1, 1), p.range("amplitude", "Amplitude", 0, 4, 0.001, 1, 0.5, 1.5)],
    emit: ({ input, out, param }) => `let ${out("value")} = (sin(${input("value")} * ${param("frequency")} + ${param("phase")} + ${input("phaseMod")}) * 0.5 + 0.5) * ${param("amplitude")};`
  },
  cosineMath: {
    type: "cosineMath",
    label: "Cosine Math",
    category: "Math",
    inputs: [input("value", "value"), input("phaseMod", "phase")],
    outputs: [output("value", "value")],
    params: [p.range("frequency", "Frequency", 0.01, 80, 0.001, 1, 0.5, 8), p.range("phase", "Phase", -6.28318, 6.28318, 0.001, 0, -1, 1), p.range("amplitude", "Amplitude", 0, 4, 0.001, 1, 0.5, 1.5)],
    emit: ({ input, out, param }) => `let ${out("value")} = (cos(${input("value")} * ${param("frequency")} + ${param("phase")} + ${input("phaseMod")}) * 0.5 + 0.5) * ${param("amplitude")};`
  },
  fractValue: {
    type: "fractValue",
    label: "Fract",
    category: "Math",
    inputs: [input("value", "value")],
    outputs: [output("value", "value")],
    params: [p.range("scale", "Scale", 0.001, 80, 0.001, 1, 0.5, 12), p.range("offset", "Offset", -8, 8, 0.001, 0, -1, 1)],
    emit: ({ input, out, param }) => `let ${out("value")} = fract(${input("value")} * ${param("scale")} + ${param("offset")});`
  },
  modulo: {
    type: "modulo",
    label: "Modulo",
    category: "Math",
    inputs: [input("value", "value"), input("periodMod", "period")],
    outputs: [output("value", "value")],
    params: [p.range("period", "Period", 0.001, 8, 0.001, 1, 0.25, 2), p.range("scale", "Scale", 0.001, 8, 0.001, 1, 0.5, 2)],
    emit: ({ input, out, param }) => `
let ${out("value")}_period = max(${param("period")} + ${input("periodMod")}, 0.0001);
let ${out("value")} = safeMod(${input("value")} * ${param("scale")}, ${out("value")}_period) / ${out("value")}_period;`
  },
  quantize: {
    type: "quantize",
    label: "Quantize",
    category: "Math",
    inputs: [input("value", "value")],
    outputs: [output("value", "value")],
    params: [p.range("steps", "Steps", 2, 64, 1, 6, 3, 16), p.range("mix", "Mix", 0, 1, 0.001, 1, 0.5, 1)],
    emit: ({ input, out, param }) => `
let ${out("value")}_steps = max(2.0, round(${param("steps")}));
let ${out("value")}_q = floor(clamp(${input("value")}, 0.0, 1.0) * ${out("value")}_steps) / (${out("value")}_steps - 1.0);
let ${out("value")} = mix(${input("value")}, ${out("value")}_q, ${param("mix")});`
  },
  distanceToPoint: {
    type: "distanceToPoint",
    label: "Distance",
    category: "Math",
    inputs: [...xyInput("coord"), ...xyInput("center", "center")],
    outputs: [output("value", "value")],
    params: [p.range("scale", "Scale", 0.001, 16, 0.001, 1, 0.5, 3), p.range("offset", "Offset", -4, 4, 0.001, 0, -0.5, 0.5)],
    emit: ({ input, out, param }) => `let ${out("value")} = length(${input("coord")} - ${input("center")}) * ${param("scale")} + ${param("offset")};`
  },
  angleField: {
    type: "angleField",
    label: "Angle",
    category: "Math",
    inputs: [...xyInput("coord"), ...xyInput("center", "center")],
    outputs: [output("value", "value")],
    params: [p.range("turns", "Turns", 0.1, 32, 0.001, 1, 0.5, 6), p.range("offset", "Offset", -1, 1, 0.001, 0, -0.25, 0.25)],
    emit: ({ input, out, param }) => `
let ${out("value")}_p = ${input("coord")} - ${input("center")};
let ${out("value")} = fract((atan2(${out("value")}_p.y, ${out("value")}_p.x) / 6.2831853) * ${param("turns")} + ${param("offset")} + 1.0);`
  },
  smoothMin: {
    type: "smoothMin",
    label: "Smooth Min",
    category: "Math",
    inputs: [input("a", "a"), input("b", "b")],
    outputs: [output("value", "value")],
    params: [p.range("smoothness", "Smoothness", 0.001, 4, 0.001, 0.25, 0.08, 0.7)],
    emit: ({ input, out, param }) => `
let ${out("value")}_h = clamp(0.5 + 0.5 * (${input("b")} - ${input("a")}) / max(${param("smoothness")}, 0.0001), 0.0, 1.0);
let ${out("value")} = mix(${input("b")}, ${input("a")}, ${out("value")}_h) - ${param("smoothness")} * ${out("value")}_h * (1.0 - ${out("value")}_h);`
  },
  smoothMax: {
    type: "smoothMax",
    label: "Smooth Max",
    category: "Math",
    inputs: [input("a", "a"), input("b", "b")],
    outputs: [output("value", "value")],
    params: [p.range("smoothness", "Smoothness", 0.001, 4, 0.001, 0.25, 0.08, 0.7)],
    emit: ({ input, out, param }) => `
let ${out("value")}_h = clamp(0.5 - 0.5 * (${input("b")} - ${input("a")}) / max(${param("smoothness")}, 0.0001), 0.0, 1.0);
let ${out("value")} = mix(${input("b")}, ${input("a")}, ${out("value")}_h) + ${param("smoothness")} * ${out("value")}_h * (1.0 - ${out("value")}_h);`
  },
  normalizeCenter: {
    type: "normalizeCenter",
    label: "Center Gain",
    category: "Math",
    inputs: [input("value", "value")],
    outputs: [output("value", "value")],
    params: [p.range("center", "Center", -4, 4, 0.001, 0.5, 0.25, 0.75), p.range("gain", "Gain", -8, 8, 0.001, 1, 0.5, 2), p.range("offset", "Offset", -4, 4, 0.001, 0.5, 0.25, 0.75)],
    emit: ({ input, out, param }) => `let ${out("value")} = (${input("value")} - ${param("center")}) * ${param("gain")} + ${param("offset")};`
  },
  colorRamp: {
    type: "colorRamp",
    label: "Color Ramp",
    category: "Coloring",
    inputs: [input("value", "value", true)],
    outputs: [...rgbaOutput("color")],
    params: [p.color("colorA", "Low Color", "#09111f"), p.color("colorB", "High Color", "#6de6ff"), p.range("gamma", "Gamma", 0.1, 5, 0.001, 1, 0.5, 2.5)],
    emit: ({ input, out, paramColor, param }) => `
let ${out("color")}_t = clamp(pow(abs(${input("value")}), max(${param("gamma")}, 0.0001)), 0.0, 1.0);
let ${out("color")} = vec4f(mix(${paramColor("colorA")}.rgb, ${paramColor("colorB")}.rgb, ${out("color")}_t), 1.0);`
  },
  palette: {
    type: "palette",
    label: "Palette",
    category: "Coloring",
    inputs: [input("value", "value", true)],
    outputs: [...rgbaOutput("color")],
    params: [p.color("a", "Color A", "#0a0e17"), p.color("b", "Color B", "#3bc2ff"), p.color("c", "Color C", "#f7ff7a"), p.range("contrast", "Contrast", 0.2, 4, 0.001, 1, 0.6, 2)],
    emit: ({ input, out, paramColor, param }) => `
let ${out("color")}_t = clamp((${input("value")} - 0.5) * ${param("contrast")} + 0.5, 0.0, 1.0);
let ${out("color")}_ab = mix(${paramColor("a")}.rgb, ${paramColor("b")}.rgb, smoothstep(0.0, 0.5, ${out("color")}_t));
let ${out("color")}_bc = mix(${paramColor("b")}.rgb, ${paramColor("c")}.rgb, smoothstep(0.5, 1.0, ${out("color")}_t));
let ${out("color")} = vec4f(mix(${out("color")}_ab, ${out("color")}_bc, step(0.5, ${out("color")}_t)), 1.0);`
  },
  cosinePalette: {
    type: "cosinePalette",
    label: "Cosine Palette",
    category: "Coloring",
    inputs: [input("value", "value", true), input("phaseMod", "phase")],
    outputs: [...rgbaOutput("color")],
    params: [
      p.color("base", "Base", "#7a6cff"),
      p.color("amplitude", "Amplitude", "#62f0c6"),
      p.color("frequency", "Frequency", "#fff06a"),
      p.color("phase", "Phase", "#ff6b8b"),
      p.range("contrast", "Contrast", 0.1, 4, 0.001, 1, 0.65, 2.2)
    ],
    emit: ({ input, out, paramColor, param }) => `
let ${out("color")}_t = (${input("value")} - 0.5) * ${param("contrast")} + 0.5 + ${input("phaseMod")};
let ${out("color")}_rgb = ${paramColor("base")}.rgb * 0.5 + (${paramColor("amplitude")}.rgb * 0.5) * cos(6.2831853 * (${paramColor("frequency")}.rgb * ${out("color")}_t + ${paramColor("phase")}.rgb));
let ${out("color")} = vec4f(clamp(${out("color")}_rgb, vec3f(0.0), vec3f(1.0)), 1.0);`
  },
  colorRamp5: {
    type: "colorRamp5",
    label: "Color Ramp 5",
    category: "Coloring",
    inputs: [input("value", "value", true)],
    outputs: [...rgbaOutput("color")],
    params: [
      p.color("c0", "Color 1", "#06121f"),
      p.color("c1", "Color 2", "#174ea6"),
      p.color("c2", "Color 3", "#34d399"),
      p.color("c3", "Color 4", "#facc15"),
      p.color("c4", "Color 5", "#fb7185"),
      p.range("gamma", "Gamma", 0.1, 5, 0.001, 1, 0.5, 2.2)
    ],
    emit: ({ input, out, paramColor, param }) => `
let ${out("color")}_t = clamp(pow(abs(${input("value")}), max(${param("gamma")}, 0.0001)), 0.0, 1.0);
let ${out("color")}_p = ${out("color")}_t * 4.0;
let ${out("color")}_a = mix(${paramColor("c0")}.rgb, ${paramColor("c1")}.rgb, smoothstep(0.0, 1.0, ${out("color")}_p));
let ${out("color")}_b = mix(${paramColor("c1")}.rgb, ${paramColor("c2")}.rgb, smoothstep(1.0, 2.0, ${out("color")}_p));
let ${out("color")}_c = mix(${paramColor("c2")}.rgb, ${paramColor("c3")}.rgb, smoothstep(2.0, 3.0, ${out("color")}_p));
let ${out("color")}_d = mix(${paramColor("c3")}.rgb, ${paramColor("c4")}.rgb, smoothstep(3.0, 4.0, ${out("color")}_p));
let ${out("color")}_low = mix(${out("color")}_a, ${out("color")}_b, step(1.0, ${out("color")}_p));
let ${out("color")}_high = mix(${out("color")}_c, ${out("color")}_d, step(3.0, ${out("color")}_p));
let ${out("color")} = vec4f(mix(${out("color")}_low, ${out("color")}_high, step(2.0, ${out("color")}_p)), 1.0);`
  },
  coordGradient: {
    type: "coordGradient",
    label: "Coord Gradient",
    category: "Coloring",
    inputs: [...xyInput("coord")],
    outputs: [...rgbaOutput("color")],
    params: [
      p.color("colorA", "Color A", "#0f172a"),
      p.color("colorB", "Color B", "#22d3ee"),
      p.select("mode", "Mode", [
        { label: "Linear", value: 0 },
        { label: "Radial", value: 1 },
        { label: "Angular", value: 2 }
      ], 0),
      p.range("angle", "Angle", -3.14159, 3.14159, 0.001, 0, -0.7, 0.7),
      p.range("scale", "Scale", 0.1, 12, 0.001, 1, 0.5, 3),
      p.range("offset", "Offset", -2, 2, 0.001, 0.5, 0.25, 0.75)
    ],
    emit: ({ input, out, paramColor, param }) => `
let ${out("color")}_mode = i32(round(${param("mode")}));
let ${out("color")}_dir = vec2f(cos(${param("angle")}), sin(${param("angle")}));
var ${out("color")}_t = dot(${input("coord")}, ${out("color")}_dir) * ${param("scale")} + ${param("offset")};
if (${out("color")}_mode == 1) {
  ${out("color")}_t = length(${input("coord")}) * ${param("scale")};
}
if (${out("color")}_mode == 2) {
  ${out("color")}_t = atan2(${input("coord")}.y, ${input("coord")}.x) / 6.2831853 * ${param("scale")} + ${param("offset")};
}
let ${out("color")} = vec4f(mix(${paramColor("colorA")}.rgb, ${paramColor("colorB")}.rgb, fract(${out("color")}_t)), 1.0);`
  },
  hsvShift: {
    type: "hsvShift",
    label: "HSV Shift",
    category: "Coloring",
    inputs: [...rgbaInput("color", "", true), input("shiftMod", "shift")],
    outputs: [...rgbaOutput("color")],
    params: [p.range("shift", "Hue Shift", -1, 1, 0.001, 0, -0.35, 0.35), p.range("saturation", "Saturation", 0, 3, 0.001, 1, 0.6, 1.6), p.range("value", "Value", 0, 3, 0.001, 1, 0.6, 1.5)],
    emit: ({ input, out, param }) => `
let ${out("color")}_hsv = rgb2hsv(${input("color")}.rgb);
let ${out("color")}_rgb = hsv2rgb(vec3f(fract(${out("color")}_hsv.x + ${param("shift")} + ${input("shiftMod")}), clamp(${out("color")}_hsv.y * ${param("saturation")}, 0.0, 3.0), clamp(${out("color")}_hsv.z * ${param("value")}, 0.0, 3.0)));
let ${out("color")} = vec4f(${out("color")}_rgb, ${input("color")}.a);`
  },
  posterize: {
    type: "posterize",
    label: "Posterize",
    category: "Coloring",
    inputs: [...rgbaInput("color", "", true)],
    outputs: [...rgbaOutput("color")],
    params: [p.range("levels", "Levels", 2, 24, 1, 6, 3, 12)],
    emit: ({ input, out, param }) => `
let ${out("color")}_levels = max(2.0, ${param("levels")});
let ${out("color")} = vec4f(floor(${input("color")}.rgb * ${out("color")}_levels) / (${out("color")}_levels - 1.0), ${input("color")}.a);`
  },
  blendColors: {
    type: "blendColors",
    label: "Blend Colors",
    category: "Coloring",
    inputs: [...rgbaInput("a", "a"), ...rgbaInput("b", "b"), input("factor", "factor")],
    outputs: [...rgbaOutput("color")],
    params: [p.range("factor", "Factor", 0, 1, 0.001, 0.5, 0, 1)],
    emit: ({ input, out, param }) => `let ${out("color")} = mix(${input("a")}, ${input("b")}, clamp(${param("factor")} + ${input("factor")}, 0.0, 1.0));`
  },
  blendMode: {
    type: "blendMode",
    label: "Blend Mode",
    category: "Coloring",
    inputs: [...rgbaInput("a", "a"), ...rgbaInput("b", "b"), input("factor", "factor")],
    outputs: [...rgbaOutput("color")],
    params: [
      p.select("mode", "Mode", [
        { label: "Multiply", value: 0 },
        { label: "Screen", value: 1 },
        { label: "Overlay", value: 2 },
        { label: "Difference", value: 3 },
        { label: "Lighten", value: 4 },
        { label: "Darken", value: 5 }
      ], 1),
      p.range("factor", "Factor", 0, 1, 0.001, 0.65, 0.25, 1)
    ],
    emit: ({ input, out, param }) => `
let ${out("color")}_a = ${input("a")};
let ${out("color")}_b = ${input("b")};
let ${out("color")}_mode = i32(round(${param("mode")}));
var ${out("color")}_rgb = ${out("color")}_a.rgb * ${out("color")}_b.rgb;
if (${out("color")}_mode == 1) {
  ${out("color")}_rgb = vec3f(1.0) - (vec3f(1.0) - ${out("color")}_a.rgb) * (vec3f(1.0) - ${out("color")}_b.rgb);
}
if (${out("color")}_mode == 2) {
  let ${out("color")}_low = 2.0 * ${out("color")}_a.rgb * ${out("color")}_b.rgb;
  let ${out("color")}_high = vec3f(1.0) - 2.0 * (vec3f(1.0) - ${out("color")}_a.rgb) * (vec3f(1.0) - ${out("color")}_b.rgb);
  ${out("color")}_rgb = mix(${out("color")}_low, ${out("color")}_high, step(vec3f(0.5), ${out("color")}_a.rgb));
}
if (${out("color")}_mode == 3) {
  ${out("color")}_rgb = abs(${out("color")}_a.rgb - ${out("color")}_b.rgb);
}
if (${out("color")}_mode == 4) {
  ${out("color")}_rgb = max(${out("color")}_a.rgb, ${out("color")}_b.rgb);
}
if (${out("color")}_mode == 5) {
  ${out("color")}_rgb = min(${out("color")}_a.rgb, ${out("color")}_b.rgb);
}
let ${out("color")} = vec4f(mix(${out("color")}_a.rgb, ${out("color")}_rgb, clamp(${param("factor")} + ${input("factor")}, 0.0, 1.0)), mix(${out("color")}_a.a, ${out("color")}_b.a, clamp(${param("factor")} + ${input("factor")}, 0.0, 1.0)));`
  },
  valueToAlpha: {
    type: "valueToAlpha",
    label: "Value To Alpha",
    category: "Coloring",
    inputs: [...rgbaInput("color", "", true), input("value", "value")],
    outputs: [...rgbaOutput("color")],
    params: [p.range("gain", "Gain", 0, 4, 0.001, 1, 0.7, 1.8), p.toggle("invert", "Invert", false)],
    emit: ({ input, out, param }) => `
let ${out("color")}_a = clamp(${input("value")} * ${param("gain")}, 0.0, 1.0);
let ${out("color")} = vec4f(${input("color")}.rgb, select(${out("color")}_a, 1.0 - ${out("color")}_a, ${param("invert")} > 0.5));`
  },
  colorBalance: {
    type: "colorBalance",
    label: "Color Balance",
    category: "Coloring",
    inputs: [...rgbaInput("color", "", true)],
    outputs: [...rgbaOutput("color")],
    params: [
      p.range("brightness", "Brightness", -1, 1, 0.001, 0, -0.18, 0.18),
      p.range("contrast", "Contrast", 0, 3, 0.001, 1, 0.75, 1.5),
      p.range("saturation", "Saturation", 0, 3, 0.001, 1, 0.6, 1.6),
      p.range("temperature", "Temperature", -1, 1, 0.001, 0, -0.25, 0.25),
      p.range("tint", "Tint", -1, 1, 0.001, 0, -0.2, 0.2)
    ],
    emit: ({ input, out, param }) => `
let ${out("color")}_luma = dot(${input("color")}.rgb, vec3f(0.2126, 0.7152, 0.0722));
var ${out("color")}_rgb = mix(vec3f(${out("color")}_luma), ${input("color")}.rgb, ${param("saturation")});
${out("color")}_rgb = (${out("color")}_rgb - vec3f(0.5)) * ${param("contrast")} + vec3f(0.5 + ${param("brightness")});
${out("color")}_rgb = ${out("color")}_rgb + vec3f(${param("temperature")}, ${param("tint")} * 0.5, -${param("temperature")});
let ${out("color")} = vec4f(clamp(${out("color")}_rgb, vec3f(0.0), vec3f(1.0)), ${input("color")}.a);`
  },
  output: {
    type: "output",
    label: "Output",
    category: "Output",
    inputs: [...rgbaInput("color", "", true)],
    outputs: [...rgbaOutput("color")],
    params: [
      p.range("exposure", "Exposure", 0, 4, 0.001, 1, 0.5, 1.6),
      p.range("gamma", "Gamma", 0.1, 4, 0.001, 1, 0.6, 1.6),
      p.range("saturation", "Saturation", 0, 3, 0.001, 1, 0.7, 1.5),
      p.range("vignette", "Vignette", 0, 2, 0.001, 0, 0, 0.7),
      p.range("grain", "Grain", 0, 0.5, 0.001, 0, 0, 0.08)
    ],
    emit: ({ input, out, param }) => `
var ${out("color")}_rgb = max(${input("color")}.rgb * ${param("exposure")}, vec3f(0.0));
let ${out("color")}_luma = dot(${out("color")}_rgb, vec3f(0.2126, 0.7152, 0.0722));
${out("color")}_rgb = mix(vec3f(${out("color")}_luma), ${out("color")}_rgb, ${param("saturation")});
let ${out("color")}_vig = 1.0 - smoothstep(0.35, 1.65, length(world) * ${param("vignette")});
let ${out("color")}_grain = (hash21(pixel + vec2f(floor(frame.time * 60.0), 19.7)) - 0.5) * ${param("grain")};
${out("color")}_rgb = pow(max(${out("color")}_rgb * mix(1.0, ${out("color")}_vig, clamp(${param("vignette")}, 0.0, 1.0)) + vec3f(${out("color")}_grain), vec3f(0.0)), vec3f(1.0 / max(${param("gamma")}, 0.0001)));
let ${out("color")} = vec4f(clamp(${out("color")}_rgb, vec3f(0.0), vec3f(1.0)), clamp(${input("color")}.a, 0.0, 1.0));`
  }
  };
}

function isSpeedParam(id) {
  return String(id).toLowerCase().includes("speed");
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number(value)));
}
