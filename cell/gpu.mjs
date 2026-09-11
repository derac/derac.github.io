import * as shaders from './shaders.mjs';
import { initialField, scaleConfig, coefficients, paletteStops, layerRamps, colorPhases, CHANNELS, SCALES } from './model.mjs';
import { checkResolution, resolutionLimit } from './limits.mjs';
export function packConfig(n, p, width = n, height = n) {
  const data = new Float32Array(512), c = coefficients(p);
  data.set([n, p.mode === 'lattice' ? 1 : 0, p.growth, p.layerCount], 0);
  data.set([p.feed, p.kill, p.diffusion, p.coupling], 4);
  data.set([p.memory, c[0], c[1], c[2]], 8); data[12] = c[3];
  data.set([p.hue, p.bands, p.contrast, p.relief], 16);
  const colors = paletteStops(p);
  data.set([p.colorMix, ['color', 'field', 'regions', 'raw'].indexOf(p.view), colors.length - 1, ['legacy','layers','spectral'].indexOf(p.colorStyle)], 20);
  scaleConfig(p, n).forEach((s, i) => {data.set([s.r, s.inhibitor, s.amount, s.weight], 256 + i * 4);data[304+i*4]=s.gate;});
  data.set([p.regionality,p.regionVariation,p.colorMemory,p.separation],48);
  data.set([p.colorDrift,p.saturation,0,0],52);data.set(colorPhases(p),56);
  data.set([p.kernel==='smooth'?3:1,width,height,0],60);
  colors.forEach((color, i) => data.set([...color, 1], 64 + i * 4));
  layerRamps(p).forEach((r,i)=>{data.set([...r.dark,1],352+i*12);data.set([...r.mid,1],356+i*12);data.set([...r.light,1],360+i*12);data[305+i*4]=r.phase;});
  return data;
}
export class GPUEngine {
  static async create(canvas, onError) {
    if (!navigator.gpu) throw Error('WebGPU is unavailable in this browser.');
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) throw Error('No WebGPU adapter was available.');
    const device = await adapter.requestDevice({ requiredLimits: { maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize, maxBufferSize: adapter.limits.maxBufferSize } });
    const engine = new GPUEngine(); engine.device = device; engine.canvas = canvas;
    engine.name = 'WebGPU'; engine.budgetMiB = 512; engine.limits = device.limits;
    device.addEventListener('uncapturederror', e => onError(e.error.message));
    device.lost.then(info => { if (!engine.destroyed) onError(`GPU device lost: ${info.message}. Reload to retry or choose the CPU fallback.`); });
    engine.uniform = device.createBuffer({ label: 'Parameters', size: 2048, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
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
  get limitOptions() { return {budgetMiB:this.budgetMiB,currentSize:this.n||0,backend:this.name,limits:this.limits,viewPixels:this.canvas.width*this.canvas.height}; }
  get maxSize() { return resolutionLimit(this.limitOptions); }
  async init(n, p, state, iteration = 0) {
    checkResolution(n,this.limitOptions);
    await this.device.queue.onSubmittedWorkDone();
    // Build beside the old field; commit only after scoped allocation/validation succeeds.
    const candidate=Object.create(this);candidate.buffers=[];
    this.device.pushErrorScope('out-of-memory');this.device.pushErrorScope('validation');
    let failure;
    try { await candidate.allocate(n,p,state,iteration); } catch(error) { failure=error; }
    const validation=await this.device.popErrorScope(), memory=await this.device.popErrorScope();
    if(failure||validation||memory){candidate.buffers.forEach(b=>b.destroy());throw failure||Error((validation||memory).message);}
    const previous=this.buffers;Object.assign(this,candidate);previous?.forEach(b=>b.destroy());
    this.resize();this.render(p);
  }
  async allocate(n, p, state, iteration) {
    this.n = n; this.iteration = iteration; this.current = 0;
    const buffer = (size, label) => {
      const b = this.device.createBuffer({ label, size, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC });
      this.buffers.push(b); return b;
    };
    const bytes = n * n * CHANNELS * 4;
    this.fields = [buffer(bytes, 'Field A'), buffer(bytes, 'Field B')];
    this.grown = buffer(bytes, 'Inflated field');
    this.horizontal = buffer(n * n * SCALES * 8, 'Horizontal averages');
    this.blurred = buffer(n * n * SCALES * 8, 'Scale averages');
    this.partial = buffer(Math.ceil(n * n / 256) * 8, 'Partial extrema');
    this.bounds = buffer(8, 'Global extrema');
    const rows=Math.max(1,Math.floor(4*1024*1024/(n*CHANNELS*4)));
    for(let row=0;row<n;row+=rows){
      const count=Math.min(rows,n-row);
      const chunk=typeof state==='function'?await state(row,count):state?state.subarray(row*n*CHANNELS,(row+count)*n*CHANNELS):initialField(n,p,row,count);
      this.device.queue.writeBuffer(this.fields[0],row*n*CHANNELS*4,chunk);
      await this.device.queue.onSubmittedWorkDone();
    }
    this.groups = {};
    for (let i = 0; i < 2; i++) {
      const input = this.fields[i], output = this.fields[1 - i];
      this.groups[`relayer${i}`] = this.group(this.pipelines.relayer, [input, output]);
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
  }
  async step(p, count) {
    const n = this.n, grow = p.growth > 0;
    this.device.queue.writeBuffer(this.uniform, 0, packConfig(n, p, this.canvas.width, this.canvas.height));
    const encoder = this.device.createCommandEncoder(); const pass = encoder.beginComputePass();
    const run = (name, key, x, y = 1) => { pass.setPipeline(this.pipelines[name]); pass.setBindGroup(0, this.groups[key]); if(y===1 && x>65535)pass.dispatchWorkgroups(65535,Math.ceil(x/65535));else pass.dispatchWorkgroups(x,y); };
    for (let j = 0; j < count; j++) {
      const i = this.current, key = `${i}${grow}`;
      if (grow) run('growth', `growth${i}`, Math.ceil(n / 8), Math.ceil(n / 8));
      if (p.mode === 'turing') {
        run('horizontal', `horizontal${key}`, n);
        run('vertical', 'vertical', n, p.layerCount);
        if(p.kernel==='smooth')for(let repeat=0;repeat<2;repeat++){
          run('horizontalRepeat','horizontalRepeat',n,p.layerCount);run('vertical','vertical',n,p.layerCount);
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
  resize() {
    const rect=this.canvas.getBoundingClientRect(), dpr=globalThis.devicePixelRatio||1;
    const scale=Math.min(dpr,this.limits.maxTextureDimension2D/Math.max(1,rect.width,rect.height));
    const width=Math.max(1,Math.round(rect.width*scale)),height=Math.max(1,Math.round(rect.height*scale));
    if(this.canvas.width!==width||this.canvas.height!==height){this.canvas.width=width;this.canvas.height=height;}
  }
  async changeLayers(p,mapping) {
    const data=packConfig(this.n,p,this.canvas.width,this.canvas.height);data.fill(-1,128,140);data.set(mapping,128);
    this.device.queue.writeBuffer(this.uniform,0,data);
    const encoder=this.device.createCommandEncoder(),pass=encoder.beginComputePass();
    pass.setPipeline(this.pipelines.relayer);pass.setBindGroup(0,this.groups[`relayer${this.current}`]);
    const groups=Math.ceil(this.n*this.n/256);pass.dispatchWorkgroups(Math.min(65535,groups),Math.ceil(groups/65535));pass.end();
    this.device.queue.submit([encoder.finish()]);await this.device.queue.onSubmittedWorkDone();this.current=1-this.current;this.render(p);
  }
  render(p) {
    this.resize();
    this.device.queue.writeBuffer(this.uniform, 0, packConfig(this.n, p, this.canvas.width, this.canvas.height));
    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginRenderPass({ colorAttachments: [{ view: this.context.getCurrentTexture().createView(),
      clearValue: { r: 0.04, g: 0.05, b: 0.07, a: 1 }, loadOp: 'clear', storeOp: 'store' }] });
    pass.setPipeline(this.renderPipeline); pass.setBindGroup(0, this.groups[`display${this.current}`]); pass.draw(3); pass.end();
    this.device.queue.submit([encoder.finish()]);
  }
  async readRows(row,count) {
    const size=count*this.n*CHANNELS*4;
    const read=this.device.createBuffer({size,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
    try {
      const encoder=this.device.createCommandEncoder();
      // Periodic halo rows for the PNG relief filter, including top/bottom seams.
      for(let offset=0;offset<count;){
        const source=((row+offset)%this.n+this.n)%this.n,rows=Math.min(count-offset,this.n-source);
        encoder.copyBufferToBuffer(this.fields[this.current],source*this.n*CHANNELS*4,read,offset*this.n*CHANNELS*4,rows*this.n*CHANNELS*4);offset+=rows;
      }
      this.device.queue.submit([encoder.finish()]);await read.mapAsync(GPUMapMode.READ);
      return new Float32Array(read.getMappedRange().slice(0));
    }finally{read.destroy();}
  }
  async snapshot() {return {state:await this.readRows(0,this.n),iteration:this.iteration};}
  destroy() {
    this.destroyed = true; this.buffers?.forEach(b => b.destroy()); this.uniform?.destroy(); this.device?.destroy();
  }
}
