import * as shaders from './shaders.mjs';
import { initialField, scaleConfig, coefficients, paletteStops, layerRamps, colorPhases, CHANNELS } from './model.mjs';
export function packConfig(n, p) {
  const data = new Float32Array(256), c = coefficients(p);
  data.set([n, p.mode === 'lattice' ? 1 : 0, p.growth, 0], 0);
  data.set([p.feed, p.kill, p.diffusion, p.coupling], 4);
  data.set([p.memory, c[0], c[1], c[2]], 8); data[12] = c[3];
  data.set([p.hue, p.bands, p.contrast, p.relief], 16);
  const colors = paletteStops(p);
  data.set([p.colorMix, ['color', 'field', 'regions', 'raw'].indexOf(p.view), colors.length - 1, ['legacy','layers','spectral'].indexOf(p.colorStyle)], 20);
  scaleConfig(p, n).forEach((s, i) => {data.set([s.r, s.inhibitor, s.amount, s.weight], 24 + i * 4);data[200+i*4]=s.gate;});
  data.set([p.regionality,p.regionVariation,p.colorMemory,p.separation],48);
  data.set([p.colorDrift,p.saturation,0,0],52);data.set(colorPhases(p),56);
  data[60]=p.kernel==='smooth'?3:1;
  colors.forEach((color, i) => data.set([...color, 1], 64 + i * 4));
  layerRamps(p).forEach((r,i)=>{data.set([...r.dark,1],128+i*12);data.set([...r.mid,1],132+i*12);data.set([...r.light,1],136+i*12);data[201+i*4]=r.phase;});
  return data;
}
export class GPUEngine {
  static async create(canvas, onError) {
    if (!navigator.gpu) throw Error('WebGPU is unavailable in this browser.');
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) throw Error('No WebGPU adapter was available.');
    const device = await adapter.requestDevice();
    const engine = new GPUEngine(); engine.device = device; engine.canvas = canvas;
    engine.name = 'WebGPU'; engine.maxSize = 1024;
    device.addEventListener('uncapturederror', e => onError(e.error.message));
    device.lost.then(info => { if (!engine.destroyed) onError(`GPU device lost: ${info.message}. Reload to retry or choose the CPU fallback.`); });
    engine.uniform = device.createBuffer({ label: 'Parameters', size: 1024, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    engine.pipelines = {};
    try {
      for (const [name, code] of Object.entries(shaders)) {
        const module = device.createShaderModule({ label: name, code });
        const info = await module.getCompilationInfo();
        const errors = info.messages.filter(m => m.type === 'error');
        if (errors.length) throw Error(`${name}: ${errors.map(e => e.message).join('; ')}`);
        if (name === 'display') {
          engine.format = navigator.gpu.getPreferredCanvasFormat();
          engine.renderPipeline = await device.createRenderPipelineAsync({ label: 'Display', layout: 'auto',
            vertex: { module, entryPoint: 'vertex' }, fragment: { module, entryPoint: 'fragment', targets: [{ format: engine.format }] },
            primitive: { topology: 'triangle-list' } });
        } else engine.pipelines[name] = await device.createComputePipelineAsync({ label: name, layout: 'auto', compute: { module, entryPoint: 'main' } });
      }
      engine.context = canvas.getContext('webgpu');
      if (!engine.context) throw Error('Could not create the WebGPU canvas.');
      engine.context.configure({ device, format: engine.format, alphaMode: 'opaque' });
      return engine;
    } catch (error) { engine.destroy(); throw error; }
  }
  group(pipeline, buffers) {
    return this.device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [this.uniform, ...buffers]
      .map((buffer, binding) => ({ binding, resource: { buffer } })) });
  }
  async init(n, p, state, iteration = 0) {
    await this.device.queue.onSubmittedWorkDone();
    this.buffers?.forEach(b => b.destroy()); this.buffers = [];
    this.n = n; this.canvas.width = n; this.canvas.height = n; this.iteration = iteration; this.current = 0;
    const buffer = (size, label) => {
      const b = this.device.createBuffer({ label, size, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC });
      this.buffers.push(b); return b;
    };
    const bytes = n * n * CHANNELS * 4;
    this.fields = [buffer(bytes, 'Field A'), buffer(bytes, 'Field B')];
    this.grown = buffer(bytes, 'Inflated field');
    this.horizontal = buffer(n * n * 6 * 8, 'Horizontal averages');
    this.blurred = buffer(n * n * 6 * 8, 'Scale averages');
    this.partial = buffer(Math.ceil(n * n / 256) * 8, 'Partial extrema');
    this.bounds = buffer(8, 'Global extrema');
    this.device.queue.writeBuffer(this.fields[0], 0, state || initialField(n, p));
    this.groups = {};
    for (let i = 0; i < 2; i++) {
      const input = this.fields[i], output = this.fields[1 - i];
      this.groups[`growth${i}`] = this.group(this.pipelines.growth, [input, this.grown]);
      for (const grow of [false, true]) {
        const src = grow ? this.grown : input, key = `${i}${grow}`;
        this.groups[`horizontal${key}`] = this.group(this.pipelines.horizontal, [src, this.horizontal]);
        this.groups[`turing${key}`] = this.group(this.pipelines.turing, [src, this.blurred, output]);
        this.groups[`lattice${key}`] = this.group(this.pipelines.lattice, [src, output]);
      }
      this.groups[`reduce${i}`] = this.group(this.pipelines.reduce, [output, this.partial]);
      this.groups[`normalize${i}`] = this.group(this.pipelines.normalize, [output, this.bounds]);
      this.groups[`display${i}`] = this.group(this.renderPipeline, [input]);
    }
    this.groups.vertical = this.group(this.pipelines.vertical, [this.horizontal, this.blurred]);
    this.groups.horizontalRepeat = this.group(this.pipelines.horizontalRepeat, [this.blurred, this.horizontal]);
    this.groups.reduceFinal = this.group(this.pipelines.reduceFinal, [this.partial, this.bounds]);
    this.render(p);
  }
  async step(p, count) {
    const n = this.n, grow = p.growth > 0;
    this.device.queue.writeBuffer(this.uniform, 0, packConfig(n, p));
    const encoder = this.device.createCommandEncoder(); const pass = encoder.beginComputePass();
    const run = (name, key, x, y = 1) => { pass.setPipeline(this.pipelines[name]); pass.setBindGroup(0, this.groups[key]); pass.dispatchWorkgroups(x, y); };
    for (let j = 0; j < count; j++) {
      const i = this.current, key = `${i}${grow}`;
      if (grow) run('growth', `growth${i}`, Math.ceil(n / 8), Math.ceil(n / 8));
      if (p.mode === 'turing') {
        run('horizontal', `horizontal${key}`, n);
        run('vertical', 'vertical', n, 6);
        if(p.kernel==='smooth')for(let repeat=0;repeat<2;repeat++){
          run('horizontalRepeat','horizontalRepeat',n,6);run('vertical','vertical',n,6);
        }
        run('turing', `turing${key}`, Math.ceil(n * n / 256));
        run('reduce', `reduce${i}`, Math.ceil(n * n / 256));
        run('reduceFinal', 'reduceFinal', 1);
        run('normalize', `normalize${i}`, Math.ceil(n * n / 256));
      } else run('lattice', `lattice${key}`, Math.ceil(n / 8), Math.ceil(n / 8));
      this.current = 1 - this.current; this.iteration++;
    }
    pass.end(); this.device.queue.submit([encoder.finish()]);
    await this.device.queue.onSubmittedWorkDone(); this.render(p);
  }
  render(p) {
    this.device.queue.writeBuffer(this.uniform, 0, packConfig(this.n, p));
    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginRenderPass({ colorAttachments: [{ view: this.context.getCurrentTexture().createView(),
      clearValue: { r: 0.04, g: 0.05, b: 0.07, a: 1 }, loadOp: 'clear', storeOp: 'store' }] });
    pass.setPipeline(this.renderPipeline); pass.setBindGroup(0, this.groups[`display${this.current}`]); pass.draw(3); pass.end();
    this.device.queue.submit([encoder.finish()]);
  }
  async snapshot() {
    const size = this.n * this.n * CHANNELS * 4;
    const read = this.device.createBuffer({ size, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    try {
      const encoder = this.device.createCommandEncoder(); encoder.copyBufferToBuffer(this.fields[this.current], 0, read, 0, size);
      this.device.queue.submit([encoder.finish()]); await read.mapAsync(GPUMapMode.READ);
      return { state: new Float32Array(read.getMappedRange().slice(0)), iteration: this.iteration };
    } finally { read.destroy(); }
  }
  destroy() {
    this.destroyed = true; this.buffers?.forEach(b => b.destroy()); this.uniform?.destroy(); this.device?.destroy();
  }
}
