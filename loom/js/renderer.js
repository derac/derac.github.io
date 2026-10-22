import { compileGraph, packParams } from "./compiler.js";
import { graphSignature } from "./nodes.js";
import { readTimeScale } from "./settings.js";

const FRAME_FLOATS = 20;
const FRAME_BYTES = FRAME_FLOATS * 4;
const TRANSITION_TYPES = Object.freeze({
  crossfade: 0,
  fadeBlack: 1,
  wipe: 2,
  dissolve: 3
});

const RENDER_WGSL = `
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

struct VertexOut {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
};

@group(0) @binding(0) var<uniform> frame: Frame;
@group(0) @binding(1) var currentTex: texture_2d<f32>;
@group(0) @binding(2) var previousTex: texture_2d<f32>;
@group(0) @binding(3) var texSampler: sampler;

fn hash21(p: vec2f) -> f32 {
  return fract(sin(dot(p, vec2f(41.13, 289.7))) * 43758.5453);
}

@vertex
fn vs(@builtin(vertex_index) vertexIndex: u32) -> VertexOut {
  var positions = array<vec2f, 3>(
    vec2f(-1.0, -3.0),
    vec2f(3.0, 1.0),
    vec2f(-1.0, 1.0)
  );
  var out: VertexOut;
  out.position = vec4f(positions[vertexIndex], 0.0, 1.0);
  out.uv = out.position.xy * 0.5 + vec2f(0.5);
  out.uv.y = 1.0 - out.uv.y;
  return out;
}

@fragment
fn fs(in: VertexOut) -> @location(0) vec4f {
  let current = textureSample(currentTex, texSampler, in.uv);
  let previous = textureSample(previousTex, texSampler, in.uv);
  let t = clamp(frame.transition.x, 0.0, 1.0);
  let kind = i32(round(frame.transition.y));
  let enabled = frame.transition.z > 0.5;
  if (!enabled) {
    return current;
  }
  if (kind == 1) {
    if (t < 0.5) {
      return mix(previous, vec4f(0.0, 0.0, 0.0, 1.0), t * 2.0);
    }
    return mix(vec4f(0.0, 0.0, 0.0, 1.0), current, (t - 0.5) * 2.0);
  }
  if (kind == 2) {
    return mix(previous, current, step(in.uv.x, t));
  }
  if (kind == 3) {
    let grain = hash21(floor(in.uv * frame.resolution / 3.0));
    return mix(previous, current, step(grain, t));
  }
  return mix(previous, current, t);
}
`;

export class WebGPURenderer {
  constructor(canvas, status = () => {}, diagnostics = () => {}) {
    this.canvas = canvas;
    this.status = status;
    this.diagnostics = diagnostics;
    this.ready = false;
    this.device = null;
    this.context = null;
    this.format = null;
    this.width = 0;
    this.height = 0;
    this.outputTexture = null;
    this.previousTexture = null;
    this.frameBuffer = null;
    this.paramBuffer = null;
    this.sampler = null;
    this.renderPipeline = null;
    this.computePipeline = null;
    this.paramLayout = [];
    this.currentSignature = "";
    this.pendingSignature = "";
    this.pendingCompile = null;
    this.computeBindGroup = null;
    this.renderBindGroup = null;
    this.bindGroupsDirty = true;
    this.frameValues = new Float32Array(FRAME_FLOATS);
    this.transition = {
      active: false,
      type: "crossfade",
      start: 0,
      duration: 1
    };
  }

  async init() {
    if (!navigator.gpu) {
      this.status("WebGPU is not available in this browser. Use current Chrome or Edge from localhost.");
      return false;
    }
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) {
      this.status("No WebGPU adapter was found.");
      return false;
    }
    this.device = await adapter.requestDevice();
    this.device.lost.then((info) => {
      this.status(`WebGPU device lost: ${info.message || info.reason}`);
      this.ready = false;
    });
    this.context = this.canvas.getContext("webgpu");
    this.format = navigator.gpu.getPreferredCanvasFormat();
    this.context.configure({
      device: this.device,
      format: this.format,
      alphaMode: "opaque"
    });
    this.frameBuffer = this.device.createBuffer({
      label: "Frame uniforms",
      size: FRAME_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    this.paramBuffer = this.device.createBuffer({
      label: "Node params",
      size: 16,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    });
    this.sampler = this.device.createSampler({
      magFilter: "linear",
      minFilter: "linear"
    });
    this.renderPipeline = this.device.createRenderPipeline({
      label: "Display pipeline",
      layout: "auto",
      vertex: {
        module: this.device.createShaderModule({ code: RENDER_WGSL }),
        entryPoint: "vs"
      },
      fragment: {
        module: this.device.createShaderModule({ code: RENDER_WGSL }),
        entryPoint: "fs",
        targets: [{ format: this.format }]
      },
      primitive: { topology: "triangle-list" }
    });
    this.ready = true;
    this.resize();
    this.status("WebGPU ready.");
    return true;
  }

  render(state, audioFeatures = {}, mouse = { x: 0, y: 0 }) {
    if (!this.ready) return false;
    this.resize();
    const signature = graphSignature(state.graph);
    this.ensureComputePipeline(state.graph);
    if (!this.computePipeline || this.currentSignature !== signature) return false;

    const params = packParams(state.graph, this.paramLayout);
    this.ensureParamBuffer(params.byteLength);
    this.device.queue.writeBuffer(this.paramBuffer, 0, params);
    this.updateFrameBuffer(state, audioFeatures, mouse);
    this.ensureBindGroups();

    const encoder = this.device.createCommandEncoder({ label: "Function frame" });
    const computePass = encoder.beginComputePass({ label: "Compute function texture" });
    computePass.setPipeline(this.computePipeline);
    computePass.setBindGroup(0, this.computeBindGroup);
    computePass.dispatchWorkgroups(Math.ceil(this.width / 8), Math.ceil(this.height / 8));
    computePass.end();

    const renderPass = encoder.beginRenderPass({
      label: "Present function texture",
      colorAttachments: [
        {
          view: this.context.getCurrentTexture().createView(),
          clearValue: { r: 0.02, g: 0.025, b: 0.035, a: 1 },
          loadOp: "clear",
          storeOp: "store"
        }
      ]
    });
    renderPass.setPipeline(this.renderPipeline);
    renderPass.setBindGroup(0, this.renderBindGroup);
    renderPass.draw(3);
    renderPass.end();
    this.device.queue.submit([encoder.finish()]);
    return true;
  }

  async captureOutputThumbnail(maxWidth = 320, quality = 0.72) {
    if (!this.ready || !this.outputTexture || !this.width || !this.height) return "";
    const width = this.width;
    const height = this.height;
    const bytesPerPixel = 4;
    const unpaddedBytesPerRow = width * bytesPerPixel;
    const bytesPerRow = align(unpaddedBytesPerRow, 256);
    const bufferSize = bytesPerRow * height;
    const buffer = this.device.createBuffer({
      label: "History thumbnail readback",
      size: bufferSize,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
    });

    const encoder = this.device.createCommandEncoder({ label: "Capture history thumbnail" });
    encoder.copyTextureToBuffer(
      { texture: this.outputTexture },
      { buffer, bytesPerRow, rowsPerImage: height },
      { width, height, depthOrArrayLayers: 1 }
    );
    this.device.queue.submit([encoder.finish()]);
    await this.device.queue.onSubmittedWorkDone();
    await buffer.mapAsync(GPUMapMode.READ);

    const mapped = new Uint8Array(buffer.getMappedRange());
    const pixels = new Uint8ClampedArray(unpaddedBytesPerRow * height);
    for (let y = 0; y < height; y += 1) {
      const sourceStart = y * bytesPerRow;
      const targetStart = y * unpaddedBytesPerRow;
      pixels.set(mapped.subarray(sourceStart, sourceStart + unpaddedBytesPerRow), targetStart);
    }
    buffer.unmap();
    buffer.destroy();

    const source = document.createElement("canvas");
    source.width = width;
    source.height = height;
    const sourceCtx = source.getContext("2d");
    sourceCtx.putImageData(new ImageData(pixels, width, height), 0, 0);

    const targetWidth = Math.max(1, Math.min(maxWidth, width));
    const targetHeight = Math.max(1, Math.round(targetWidth * height / width));
    const target = document.createElement("canvas");
    target.width = targetWidth;
    target.height = targetHeight;
    const targetCtx = target.getContext("2d");
    targetCtx.drawImage(source, 0, 0, targetWidth, targetHeight);
    return target.toDataURL("image/jpeg", quality);
  }

  async beginTransitionFromCanvas(type = "crossfade", durationMs = 1200) {
    if (!this.ready || !this.width || !this.height || !window.createImageBitmap) return;
    try {
      const bitmap = await createImageBitmap(this.canvas);
      this.previousTexture?.destroy();
      this.previousTexture = this.device.createTexture({
        label: "Previous transition texture",
        size: [this.width, this.height],
        format: "rgba8unorm",
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
      });
      this.device.queue.copyExternalImageToTexture(
        { source: bitmap },
        { texture: this.previousTexture },
        { width: this.width, height: this.height }
      );
      bitmap.close?.();
      this.transition = {
        active: true,
        type,
        start: performance.now(),
        duration: Math.max(0.05, durationMs / 1000)
      };
      this.bindGroupsDirty = true;
    } catch (error) {
      this.diagnostics(`Transition capture failed: ${error.message}`, "warn");
    }
  }

  resetTransition() {
    this.transition.active = false;
  }

  resize() {
    if (!this.device) return;
    const ratio = Math.max(1, window.devicePixelRatio || 1);
    const width = Math.max(2, Math.floor(this.canvas.clientWidth * ratio));
    const height = Math.max(2, Math.floor(this.canvas.clientHeight * ratio));
    if (width === this.width && height === this.height && this.outputTexture) return;
    this.width = width;
    this.height = height;
    this.canvas.width = width;
    this.canvas.height = height;
    this.outputTexture?.destroy();
    this.outputTexture = this.device.createTexture({
      label: "Function output texture",
      size: [width, height],
      format: "rgba8unorm",
      usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC
    });
    this.previousTexture?.destroy();
    this.previousTexture = this.device.createTexture({
      label: "Blank transition texture",
      size: [width, height],
      format: "rgba8unorm",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
    });
    this.transition.active = false;
    this.bindGroupsDirty = true;
  }

  ensureComputePipeline(graph) {
    const signature = graphSignature(graph);
    if (signature === this.currentSignature || signature === this.pendingSignature) return;
    this.pendingSignature = signature;
    const compiled = compileGraph(graph);
    if (!compiled.ok) {
      this.status("Graph has validation errors.");
      this.diagnostics(compiled.errors.join("\n"), "warn");
    }
    this.pendingCompile = this.createComputePipeline(compiled, signature);
  }

  async createComputePipeline(compiled, signature) {
    try {
      const module = this.device.createShaderModule({ label: "Generated graph shader", code: compiled.wgsl });
      const compilation = await module.getCompilationInfo();
      const messages = compilation.messages.filter((message) => message.type !== "info");
      if (messages.length) {
        this.diagnostics(messages.map(formatCompilationMessage).join("\n"), "warn");
      }
      const pipeline = await this.device.createComputePipelineAsync({
        label: "Generated graph compute pipeline",
        layout: "auto",
        compute: { module, entryPoint: "main" }
      });
      if (signature !== this.pendingSignature) return;
      this.computePipeline = pipeline;
      this.paramLayout = compiled.paramLayout;
      this.currentSignature = signature;
      this.pendingSignature = "";
      this.pendingCompile = null;
      this.bindGroupsDirty = true;
      this.status(compiled.ok ? "Graph compiled." : "Fallback shader compiled.");
    } catch (error) {
      if (signature === this.pendingSignature) {
        this.pendingSignature = "";
        this.pendingCompile = null;
      }
      this.status("Shader compile failed.");
      this.diagnostics(error.message, "error");
    }
  }

  ensureParamBuffer(byteLength) {
    const needed = Math.max(16, align(byteLength, 16));
    if (this.paramBuffer && this.paramBuffer.size >= needed) return;
    this.paramBuffer?.destroy();
    this.paramBuffer = this.device.createBuffer({
      label: "Node params",
      size: needed,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    });
    this.bindGroupsDirty = true;
  }

  ensureBindGroups() {
    if (!this.bindGroupsDirty && this.computeBindGroup && this.renderBindGroup) return;
    this.computeBindGroup = this.device.createBindGroup({
      label: "Compute bind group",
      layout: this.computePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.frameBuffer } },
        { binding: 1, resource: this.outputTexture.createView() },
        { binding: 2, resource: { buffer: this.paramBuffer } }
      ]
    });
    this.renderBindGroup = this.device.createBindGroup({
      label: "Render bind group",
      layout: this.renderPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.frameBuffer } },
        { binding: 1, resource: this.outputTexture.createView() },
        { binding: 2, resource: this.previousTexture.createView() },
        { binding: 3, resource: this.sampler }
      ]
    });
    this.bindGroupsDirty = false;
  }

  updateFrameBuffer(state, audio, mouse) {
    const transition = this.transitionState();
    this.frameValues[0] = this.width;
    this.frameValues[1] = this.height;
    this.frameValues[2] = state.time.value || 0;
    this.frameValues[3] = readTimeScale(state);
    this.frameValues[4] = state.viewport.offsetX || 0;
    this.frameValues[5] = state.viewport.offsetY || 0;
    this.frameValues[6] = state.viewport.zoom || 1;
    this.frameValues[7] = 0;
    this.frameValues[8] = mouse.x || 0;
    this.frameValues[9] = mouse.y || 0;
    this.frameValues[10] = audio.level || 0;
    this.frameValues[11] = audio.beat || 0;
    this.frameValues[12] = audio.bass || 0;
    this.frameValues[13] = audio.mids || 0;
    this.frameValues[14] = audio.treble || 0;
    this.frameValues[15] = audio.focus || 0;
    this.frameValues[16] = transition.progress;
    this.frameValues[17] = TRANSITION_TYPES[transition.type] ?? 0;
    this.frameValues[18] = transition.active ? 1 : 0;
    this.frameValues[19] = 0;
    this.device.queue.writeBuffer(this.frameBuffer, 0, this.frameValues);
  }

  transitionState() {
    if (!this.transition.active) return { active: false, progress: 1, type: "crossfade" };
    const elapsed = (performance.now() - this.transition.start) / 1000;
    const progress = Math.min(1, elapsed / this.transition.duration);
    if (progress >= 1) {
      this.transition.active = false;
      return { active: false, progress: 1, type: this.transition.type };
    }
    return { active: true, progress, type: this.transition.type };
  }
}

function align(value, alignment) {
  return Math.ceil(value / alignment) * alignment;
}

function formatCompilationMessage(message) {
  return `${message.type.toUpperCase()} line ${message.lineNum}:${message.linePos} ${message.message}`;
}
