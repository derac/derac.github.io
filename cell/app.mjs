import { DEFAULTS, PRESETS, SPEC, LAYER_FIELDS, layerRamps, clamp, validateParams, scaleConfig, coefficients, renderPixels } from './model.mjs';
import { GPUEngine } from './gpu.mjs';
import { encodeState, decodeCheckpoint } from './state.mjs';
import { PlaybackClock, MIN_SPEED, MAX_SPEED, sliderToSpeed, speedToSlider } from './playback.mjs';

const $ = id => document.getElementById(id);
let params = validateParams(PRESETS.mineral), engine, running = !matchMedia('(prefers-reduced-motion: reduce)').matches;
let n = 512, queued = 0, framePromise = Promise.resolve(), frameActive = false, needsRender = true;
let jobs = Promise.resolve(), ready = false, lastReport = performance.now(), reportedSteps = 0;
let padBindings = [], parameterInputs = new Map(), stepCost = 1;
const playback = new PlaybackClock();
let selectedLayer=1, layerInputs=new Map();
const paintControls = ['hue', 'bands', 'contrast', 'relief', 'colorMix', 'separation', 'colorDrift', 'saturation'];
const modeKeys = () => params.mode === 'turing' ? ['scale', 'spacing', 'ratio', 'rate', 'bias', 'growth', 'regionality', 'colorMemory']
  : ['feed', 'kill', 'diffusion', 'coupling', 'memory', 'growth', 'regionVariation', 'colorMemory'];
const activeKeys = () => [...modeKeys(), ...paintControls, ...(params.mode==='turing'?Object.keys(SPEC).filter(k=>k.startsWith('layer')):[])];
const format = (key, v) => v.toFixed(SPEC[key][3] < .0001 ? 5 : SPEC[key][3] < .001 ? 4 : SPEC[key][3] < .01 ? 3 : 2);
const randomSeed = () => crypto.getRandomValues(new Uint32Array(1))[0];
function status(text) { $('status').textContent = text; }
function reportError(error) {
  running = false; $('error').hidden = false; $('error-text').textContent = error.message || String(error);
  $('cpu-fallback').hidden = engine?.name === 'CPU worker'; updateTransport();
}
function clearError() { $('error').hidden = true; }
function updateTransport() {
  $('play').textContent = running ? 'Pause' : 'Run';
  $('live-dot').classList.toggle('paused', !running);
  $('canvas-tag').textContent = running ? 'LIVE SIMULATION' : 'PAUSED';
  if (!running) $('actual-speed').textContent = 'Paused';
}
function resetTiming() {
  playback.reset(); reportedSteps = engine?.iteration || 0; lastReport = performance.now();
}
function setSpeed(value) {
  if (!Number.isFinite(value)) return;
  playback.setRate(Math.round(clamp(value, MIN_SPEED, MAX_SPEED))); resetTiming();
  $('speed').value = speedToSlider(playback.rate);
  $('speed').setAttribute('aria-valuetext', `${playback.rate} simulation steps per second`);
  if (document.activeElement !== $('speed-number')) $('speed-number').value = playback.rate;
  for (const button of document.querySelectorAll('[data-speed]')) button.setAttribute('aria-pressed', String(Number(button.dataset.speed) === playback.rate));
  try { localStorage.setItem('cellularity-playback-speed', String(playback.rate)); } catch { /* Storage is optional. */ }
}
function togglePlayback() {
  if (!ready) return;
  running = !running; resetTiming(); updateTransport(); needsRender = true;
  status(running ? 'Running' : 'Paused');
}
function advanceSteps(count) {
  if (!ready) return;
  running = false; resetTiming(); updateTransport();
  return enqueue(`Advancing ${count} ${count === 1 ? 'step' : 'steps'}…`, async () => {
    // One action uses one parameter snapshot even if the controls move during it.
    const p = { ...params };
    for (let i = 0; i < count; i += 4) {
      await engine.step(p, Math.min(4, count - i));
      $('metrics').textContent = `${engine.iteration.toLocaleString()} steps · ${n}²`;
    }
    needsRender = true; resetTiming(); status(`Advanced ${count} ${count === 1 ? 'step' : 'steps'} · ${running ? 'running' : 'paused'}`);
  }).catch(() => {});
}
function enqueue(label, fn) {
  queued++; status(label);
  const result = jobs.then(async () => { await framePromise; await fn(); });
  jobs = result.catch(reportError).finally(() => { queued--; updateTransport(); });
  return result;
}
class CPUEngine {
  constructor(canvas) {
    this.canvas = canvas; this.name = 'CPU worker'; this.maxSize = 256;
    this.ctx = canvas.getContext('2d', { alpha: false });
    if (!this.ctx) throw Error('The browser could not create a canvas.');
    this.worker = new Worker(new URL('./worker.mjs', import.meta.url), { type: 'module' });
    this.pending = new Map(); this.id = 0;
    this.worker.onmessage = ({ data }) => {
      const pending = this.pending.get(data.id); if (!pending) return;
      this.pending.delete(data.id);
      if (data.error) pending.reject(Error(data.error));
      else {
        this.iteration = data.iteration;
        if (data.pixels) this.ctx.putImageData(new ImageData(new Uint8ClampedArray(data.pixels), this.n, this.n), 0, 0);
        pending.resolve(data);
      }
    };
    this.worker.onerror = event => {
      const error = Error(event.message || 'CPU worker failed.');
      for (const p of this.pending.values()) p.reject(error);
      this.pending.clear(); reportError(error);
    };
  }
  request(message, transfers = []) {
    return new Promise((resolve, reject) => {
      const id = ++this.id; this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ ...message, id }, transfers);
    });
  }
  async init(n, params, state, iteration = 0) {
    this.n = n; this.canvas.width = n; this.canvas.height = n;
    const copy = state?.slice().buffer;
    await this.request({ type: 'init', n, params, state: copy, iteration }, copy ? [copy] : []);
  }
  step(params, count) { return this.request({ type: 'step', params, count }); }
  render(params) { return this.request({ type: 'render', params }); }
  async snapshot() { const r = await this.request({ type: 'snapshot' }); return { state: new Float32Array(r.state), iteration: r.iteration }; }
  destroy() {
    this.worker.terminate(); for (const p of this.pending.values()) p.reject(Error('Engine replaced.')); this.pending.clear();
  }
}
function replaceCanvas() {
  const old = $('art'), fresh = old.cloneNode(false); old.replaceWith(fresh); return fresh;
}
async function boot(forceCPU = false) {
  ready = false; clearError(); $('loading').hidden = false;
  engine?.destroy(); let canvas = replaceCanvas(); let fallbackReason;
  if (!forceCPU) {
    try { engine = await GPUEngine.create(canvas, reportError); }
    catch (e) { fallbackReason = e.message; engine = new CPUEngine(replaceCanvas()); }
  } else engine = new CPUEngine(canvas);
  if (n > engine.maxSize) n = 128;
  $('resolution').value = n;
  for (const option of $('resolution').options) option.disabled = Number(option.value) > engine.maxSize;
  await engine.init(n, params);
  $('backend').textContent = engine.name; $('loading').hidden = true;
  for (const id of ['play', 'step', 'step-one', 'restart', 'png', 'save']) $(id).disabled = false;
  ready = true; syncValues(); updateTransport();
  if (fallbackReason) status(`CPU fallback · ${n}² · WebGPU unavailable`);
  else status(`${engine.name} · ${n} × ${n}`);
  $('backend').title = fallbackReason || 'Simulation stays on your device.';
  stepCost = engine.name === 'CPU worker' ? 8 : 1; resetTiming();
}
async function reset() {
  if (!engine) return;
  await engine.init(n, params); resetTiming(); needsRender = true; syncValues();
}
function setParameter(key, value) {
  params = validateParams({ ...params, [key]: value }); needsRender = true;
  $('preset').value = ''; syncValues();
}
function syncValues() {
  for (const b of padBindings) {
    for(const axis of ['x','y']){
      const key=b[axis],range=b.range[axis];
      if(params[key]<range[0]||params[key]>range[1])b.range[axis]=centeredRange(key,range[1]-range[0]);
    }
    const x = (params[b.x] - b.range.x[0]) / (b.range.x[1] - b.range.x[0]);
    const y = (params[b.y] - b.range.y[0]) / (b.range.y[1] - b.range.y[0]);
    b.surface.style.setProperty('--x', `${x * 100}%`); b.surface.style.setProperty('--y', `${(1 - y) * 100}%`);
    b.surface.setAttribute('aria-label', `${SPEC[b.x][0]} ${format(b.x, params[b.x])}${b.locked.x ? ', X locked' : ''}; ${SPEC[b.y][0]} ${format(b.y, params[b.y])}${b.locked.y ? ', Y locked' : ''}. Arrow keys adjust unlocked axes; Shift makes finer changes.`);
    for (const axis of ['x', 'y']) if (document.activeElement !== b[`${axis}Input`]) b[`${axis}Input`].value = format(b[axis], params[b[axis]]);
    b.rangeLabel.textContent=`X ${b.range.x.map(v=>format(b.x,v)).join('–')} · Y ${b.range.y.map(v=>format(b.y,v)).join('–')}`;
  }
  for (const [key, input] of parameterInputs) if (document.activeElement !== input) input.value = format(key, params[key]);
  for (const key of ['seed', 'ruleSeed', 'colorSeed']) if ($(`${key}-input`)) $(`${key}-input`).value = params[key];
  $('palette').value = params.palette; $('view').value = params.view;
  $('color-style').value=params.colorStyle;$('kernel').value=params.kernel;$('kernel').disabled=params.mode!=='turing';
  updateModelInfo();syncLayers();
}
function numericInput(key) {
  const input = document.createElement('input'); input.type = 'number';
  const spec = SPEC[key]; input.min = spec[1]; input.max = spec[2]; input.step = spec[3]; input.value = params[key];
  input.setAttribute('aria-label', spec[0]); return input;
}
function centeredRange(key,span){
  const spec=SPEC[key];span=Math.min(spec[2]-spec[1],Math.max(spec[3]*4,span));
  const lo=clamp(params[key]-span/2,spec[1],spec[2]-span);return[lo,Math.min(spec[2],lo+span)];
}
function buildPads() {
  $('pads').replaceChildren(); padBindings = []; parameterInputs = new Map(); $('all-params').replaceChildren();
  const pairs = params.mode === 'turing' ? [['scale', 'spacing'], ['regionality', 'growth'], ['separation', 'colorDrift']]
    : [['feed', 'kill'], ['regionVariation', 'growth'], ['hue', 'colorDrift']];
  pairs.forEach(([x, y], i) => {
    const card = document.createElement('div'); card.className = 'pad-card';
    const heading = document.createElement('div'); heading.className = 'pad-heading';
    heading.innerHTML = `<strong>${['Structure', 'Behavior', 'Color'][i]}</strong><span>0${i + 1} / XY</span>`; card.append(heading);
    const surface = document.createElement('div'); surface.className = 'pad-surface'; surface.tabIndex = 0;
    surface.setAttribute('role', 'group');
    surface.innerHTML = '<span class="pad-line-x"></span><span class="pad-line-y"></span><span class="pad-dot"></span><span class="pad-corner">← X → &nbsp; ↑ Y &nbsp; · Shift for fine</span>';
    card.append(surface); const b = { x, y, surface, range:{}, locked:{x:false,y:false} };
    const rangeTools=document.createElement('div');rangeTools.className='pad-range-tools';
    const rangeLabel=document.createElement('span');b.rangeLabel=rangeLabel;
    const closer=document.createElement('button');closer.textContent='2× closer';closer.title='Zoom into a smaller parameter range around the current values';
    const wider=document.createElement('button');wider.textContent='2× wider';wider.title='Explore a larger parameter range around the current values';
    const full=document.createElement('button');full.textContent='Full range';
    closer.onclick=()=>{for(const axis of ['x','y'])b.range[axis]=centeredRange(b[axis],(b.range[axis][1]-b.range[axis][0])/2);syncValues();};
    wider.onclick=()=>{for(const axis of ['x','y'])b.range[axis]=centeredRange(b[axis],(b.range[axis][1]-b.range[axis][0])*2);syncValues();};
    full.onclick=()=>{for(const axis of ['x','y'])b.range[axis]=SPEC[b[axis]].slice(1,3);syncValues();};
    rangeTools.append(rangeLabel,closer,wider,full);card.append(rangeTools);
    function configureAxis(axis) {
      const key = b[axis], spec = SPEC[key], input = b[`${axis}Input`];
      b.range[axis]=spec.slice(1,3);
      input.min = spec[1]; input.max = spec[2]; input.step = spec[3]; input.value = format(key, params[key]);
      input.setAttribute('aria-label', `${axis.toUpperCase()} ${spec[0]}`);
    }
    b.configureAxis=configureAxis;
    for (const axis of ['x', 'y']) {
      const row = document.createElement('div'); row.className = 'axis-row';
      const label = document.createElement('button'); label.className='axis-lock';label.textContent=axis.toUpperCase();
      const updateLock=()=>{
        label.setAttribute('aria-pressed',String(b.locked[axis]));
        label.setAttribute('aria-label',`${b.locked[axis]?'Unlock':'Lock'} pad ${i+1} ${axis.toUpperCase()} axis`);
        label.title=`${b.locked[axis]?'Unlock':'Lock'} ${axis.toUpperCase()} during pad dragging and arrow-key changes`;
        b.surface.classList.toggle(`lock-${axis}`,b.locked[axis]);
      };
      label.onclick=()=>{b.locked[axis]=!b.locked[axis];updateLock();syncValues();};updateLock();
      const select = document.createElement('select'); select.setAttribute('aria-label', `Pad ${i + 1}, ${axis.toUpperCase()} parameter`);
      const groups=new Map();
      for (const key of activeKeys()) {
        const groupName=key.startsWith('layer')?`Layer ${key.match(/\d/)[0]}`:paintControls.includes(key)?'Color':'Simulation';
        if(!groups.has(groupName)){const group=document.createElement('optgroup');group.label=groupName;groups.set(groupName,group);select.append(group);}
        groups.get(groupName).append(new Option(SPEC[key][0],key));
      }
      select.value = b[axis];
      const input = numericInput(b[axis]); b[`${axis}Input`] = input; b[`${axis}Select`] = select;
      select.onchange = () => {
        const other = axis === 'x' ? 'y' : 'x', old = b[axis]; b[axis] = select.value;
        if (b[other] === b[axis]) { b[other] = old; b[`${other}Select`].value = old; configureAxis(other); }
        configureAxis(axis); syncValues();
      };
      input.onchange = () => {
        const key = b[axis], value = input.valueAsNumber;
        if (Number.isFinite(value)) setParameter(key, clamp(value, SPEC[key][1], SPEC[key][2]));
        input.value=format(key,params[key]);
      };
      row.append(label, select, input); card.append(row);
      configureAxis(axis);
    }
    let gesture;
    const move = event => {
      const box = surface.getBoundingClientRect();
      const nx = clamp((event.clientX - box.left) / box.width), ny = clamp(1 - (event.clientY - box.top) / box.height);
      const value = (axis, f) => {
        if(b.locked[axis])return params[b[axis]];
        if(gesture?.fine){
          const distance=axis==='x'?(event.clientX-gesture.x)/box.width:(gesture.y-event.clientY)/box.height;
          return clamp(gesture.values[axis]+distance*(gesture.ranges[axis][1]-gesture.ranges[axis][0])*0.1,SPEC[b[axis]][1],SPEC[b[axis]][2]);
        }
        return clamp(b.range[axis][0]+f*(b.range[axis][1]-b.range[axis][0]),SPEC[b[axis]][1],SPEC[b[axis]][2]);
      };
      const nextX=value('x',nx),nextY=value('y',ny);
      if(nextX===params[b.x]&&nextY===params[b.y])return;
      params = { ...params, [b.x]: nextX, [b.y]: nextY }; needsRender = true; $('preset').value = ''; syncValues();
    };
    surface.onpointerdown = event => {
      if(event.button!==0||gesture)return;
      gesture={x:event.clientX,y:event.clientY,fine:event.shiftKey,values:{x:params[b.x],y:params[b.y]},ranges:{x:[...b.range.x],y:[...b.range.y]}};
      surface.focus(); surface.setPointerCapture(event.pointerId); move(event);
    };
    surface.onpointermove = event => { if (surface.hasPointerCapture(event.pointerId)) move(event); };
    surface.onpointerup = event => { if (surface.hasPointerCapture(event.pointerId)) surface.releasePointerCapture(event.pointerId); };
    surface.onlostpointercapture=()=>{gesture=null;};
    surface.onpointercancel=()=>{gesture=null;};
    surface.onkeydown = event => {
      const directions = { ArrowLeft: ['x', -1], ArrowRight: ['x', 1], ArrowDown: ['y', -1], ArrowUp: ['y', 1] };
      if (!directions[event.key]) return; event.preventDefault();
      const [axis, direction] = directions[event.key], key = b[axis], spec = SPEC[key];
      if(b.locked[axis])return;
      setParameter(key, clamp(params[key] + direction * (event.shiftKey ? .001 : .01) * (b.range[axis][1] - b.range[axis][0]), spec[1], spec[2]));
    };
    $('pads').append(card); padBindings.push(b);
  });
  for (const key of [...modeKeys(),...paintControls]) {
    const row = document.createElement('label'); row.className = 'param-row';
    const label = document.createElement('span'); label.textContent = SPEC[key][0];
    const input = numericInput(key); input.onchange = () => {
      if (Number.isFinite(input.valueAsNumber)) setParameter(key, clamp(input.valueAsNumber, SPEC[key][1], SPEC[key][2]));
      input.value = format(key, params[key]);
    };
    parameterInputs.set(key, input); row.append(label, input); $('all-params').append(row);
  }
  buildLayerInputs();syncValues();
}
const rgbHex=rgb=>'#'+rgb.map(v=>Math.round(clamp(v)*255).toString(16).padStart(2,'0')).join('');
function buildLayerInputs(){
  layerInputs.clear();$('layer-parameters').replaceChildren();
  if(params.mode==='turing')for(const [suffix,spec] of Object.entries(LAYER_FIELDS)){
    const key=`layer${selectedLayer}${suffix}`,row=document.createElement('label');row.className='param-row';
    const title=document.createElement('span');title.textContent=spec[0];const input=numericInput(key);
    input.onchange=()=>{if(Number.isFinite(input.valueAsNumber))setParameter(key,clamp(input.valueAsNumber,SPEC[key][1],SPEC[key][2]));input.value=format(key,params[key]);};
    row.append(title,input);$('layer-parameters').append(row);layerInputs.set(key,input);
  }
  syncLayers();
}
function syncLayers(){
  if(!$('layer-tabs').children.length)return;
  const ramps=layerRamps(params);
  for(let i=0;i<6;i++){
    const button=$('layer-tabs').children[i];button.style.setProperty('--layer-color',rgbHex(ramps[i].mid));
    button.setAttribute('aria-pressed',String(i+1===selectedLayer));
  }
  $('layers-title').textContent=params.mode==='turing'?'SIX INDEPENDENT SCALES':'SIX REGIONAL COLOR FAMILIES';
  $('layer-name').textContent=`${params.mode==='turing'?'Layer':'Color family'} ${selectedLayer}`;
  $('layer-to-pad').hidden=params.mode!=='turing';
  for(const [key,input] of layerInputs)if(document.activeElement!==input)input.value=format(key,params[key]);
  if(document.activeElement!==$('layer-color'))$('layer-color').value=rgbHex(ramps[selectedLayer-1].mid);
  const colorActive=params.view==='regions'||(params.view==='color'&&params.colorStyle==='layers');
  $('layer-color').disabled=!colorActive;
  $('layer-auto-color').disabled=!colorActive||params[`layer${selectedLayer}Color`]===null;
  const s=scaleConfig(params,n)[selectedLayer-1];
  $('layer-radius-note').textContent=params.mode==='turing'?`Current radii ${s.r} → ${s.inhibitor} px. Strength 0 disables this scale. Parameters change the running simulation.`:'Regional chemistry varies the shapes; these six color families follow the evolving regional fields.';
  if(!colorActive)$('layer-radius-note').textContent+=' Switch to Color / Independent layers to edit the swatches.';
}
function initializeLayerUI(){
  for(let i=1;i<=6;i++){
    const button=document.createElement('button');button.textContent=i;button.title=`Select layer ${i}`;button.setAttribute('aria-label',button.title);
    button.onclick=()=>{selectedLayer=i;buildLayerInputs();};$('layer-tabs').append(button);
  }
  $('layer-color').oninput=()=>setParameter(`layer${selectedLayer}Color`,$('layer-color').value);
  $('layer-auto-color').onclick=()=>setParameter(`layer${selectedLayer}Color`,null);
  $('layer-to-pad').onclick=()=>{
    const b=padBindings[0];b.x=`layer${selectedLayer}Radius`;b.y=`layer${selectedLayer}Gain`;
    for(const axis of ['x','y']){b[`${axis}Select`].value=b[axis];b.configureAxis(axis);}syncValues();b.surface.focus();b.surface.scrollIntoView({block:'nearest'});
  };
}
function updateModelInfo() {
  const turing = params.mode === 'turing';
  $('model-caption').textContent = turing ? 'Independent Turing scales' : 'Regional reactions';
  $('model-detail').textContent = turing ? 'Six interacting scales, separate histories, independent colors.' : 'Local chemistry changes across evolving regions. Experimental reconstruction.';
  $('scale-details').textContent = turing ? `Activator → inhibitor radii (${n}²)\n${scaleConfig(params, n).map((s, i) => `${i + 1}: ${s.r} → ${s.inhibitor} px · Δ ${s.amount.toFixed(4)}`).join('\n')}`
    : `Rule multipliers\n${coefficients(params).map(v => v.toFixed(4)).join(' · ')}\nFeed and kill are modified by local history.`;
  $('scale-details').style.whiteSpace = 'pre-line';
}
function buildSeeds() {
  for (const [key, label] of [['seed', 'Pattern'], ['ruleSeed', 'Rule'], ['colorSeed', 'Color']]) {
    const row = document.createElement('div'); row.className = 'seed-row';
    const title = document.createElement('label'); title.textContent = label; title.htmlFor = `${key}-input`;
    const input = document.createElement('input'); input.type = 'number'; input.id = `${key}-input`; input.min = 0; input.max = 0xffffffff; input.step = 1; input.value = params[key];
    const shuffle = document.createElement('button'); shuffle.textContent = '↻'; shuffle.title = `Randomize ${label.toLowerCase()} seed`; shuffle.setAttribute('aria-label', shuffle.title);
    const apply = value => {
      if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) { input.value = params[key]; return; }
      setParameter(key, value); input.value = value;
      if (key === 'seed' && ready) enqueue('Restarting the pattern…', reset).catch(() => {});
    };
    input.onchange = () => apply(input.valueAsNumber); shuffle.onclick = () => apply(randomSeed());
    row.append(title, input, shuffle); $('seeds').append(row);
  }
}
function download(blob, filename) {
  const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 15000);
}
function filename(ext) { return `cellularity-${params.mode}-${params.seed}-${engine.iteration}.${ext}`; }
async function saveState() {
  const { state, iteration } = await engine.snapshot();
  const record = { format: 'cellularity-lab-state', version: 2, n, iteration, params, backend: engine.name,
    encoding: 'float32-base64', state: encodeState(state) };
  download(new Blob([JSON.stringify(record)], { type: 'application/json' }), filename('json')); status('Full simulation state saved.');
}
async function exportPNG() {
  const { state } = await engine.snapshot(); const pixels = renderPixels(state, n, params);
  const canvas = document.createElement('canvas'); canvas.width = n; canvas.height = n;
  canvas.getContext('2d').putImageData(new ImageData(pixels, n, n), 0, 0);
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw Error('Could not encode the image.'); download(blob, filename('png')); status(`Exported ${n} × ${n} PNG.`);
}
async function loadState(file) {
  if (!file || file.size > 64 * 1024 * 1024) throw Error('Choose a state file smaller than 64 MB.');
  const record = decodeCheckpoint(JSON.parse(await file.text()), engine.maxSize), { state } = record;
  params = record.params; n = record.n; running = false; $('mode').value = params.mode; $('resolution').value = n; $('preset').value = '';
  await engine.init(n, params, state, record.iteration); buildPads(); needsRender = true; clearError();
  resetTiming(); status(record.migrated?'Old state imported · missing layer histories approximated · paused':'State restored · paused');
}
async function tick(now) {
  requestAnimationFrame(tick);
  playback.advance(now, ready && !queued && !document.hidden && running);
  if (!ready || queued || document.hidden) return;
  if (frameActive) return;
  if (now - lastReport >= 1000) {
    const sps = (engine.iteration - reportedSteps) * 1000 / (now - lastReport);
    $('actual-speed').textContent = running ? `Measured ${sps < 10 ? sps.toFixed(1) : Math.round(sps)} steps/s` : 'Paused';
    status(`${engine.name} · ${running ? 'running' : 'paused'}`);
    lastReport = now; reportedSteps = engine.iteration;
  }
  const batchLimit = Math.max(1, Math.min(32, Math.floor(20 / stepCost)));
  const steps = running ? playback.take(batchLimit) : 0;
  if (!steps && !needsRender) return;
  frameActive = true; needsRender = false;
  const p = { ...params };
  framePromise = (async () => {
    if (steps) {
      const started = performance.now(); await engine.step(p, steps);
      stepCost = stepCost * 0.8 + Math.max(0.05, (performance.now() - started) / steps) * 0.2;
    } else await engine.render(p);
    $('metrics').textContent = `${engine.iteration.toLocaleString()} steps · ${n}²`;
  })().catch(reportError).finally(() => { frameActive = false; });
}
function registerAgentTools() {
  const context = document.modelContext; if (!context?.registerTool) return;
  const lifecycle = new AbortController(); addEventListener('pagehide', () => lifecycle.abort(), { once: true });
  const tools = [{ name: 'read_cellularity_experiment', title: 'Read the current experiment',
    description: 'Read model parameters, seeds, resolution, and simulation step count without changing the experiment.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true }, execute: () => ({ params, resolution: n, iteration: engine?.iteration, running, targetStepsPerSecond: playback.rate, backend: engine?.name }) },
  { name: 'configure_cellularity_experiment', title: 'Adjust experiment parameters',
    description: 'Adjust numerical parameters of the current simulation, preserving its current field. Does not restart, change models, or export anything.',
    inputSchema: { type: 'object', properties: Object.fromEntries(Object.entries(SPEC).map(([key, [, min, max]]) => [key, { type: 'number', minimum: min, maximum: max }])), additionalProperties: false },
    annotations: { readOnlyHint: false }, execute: async input => {
      if (!input || Array.isArray(input) || typeof input !== 'object' || Object.keys(input).some(key => !SPEC[key])) throw Error('Only numeric pad parameters are accepted.');
      const next = validateParams({ ...params, ...input });
      await enqueue('Updating parameters…', async () => { params = next; syncValues(); needsRender = true; $('preset').value = ''; });
      return { params };
    } }];
  for (const tool of tools) {
    try { Promise.resolve(context.registerTool(tool, { signal: lifecycle.signal })).catch(() => {}); } catch { /* Optional browser capability. */ }
  }
}
$('preset').add(new Option('Custom experiment', ''));
for (const [key, preset] of Object.entries(PRESETS)) $('preset').add(new Option(preset.name, key));
$('preset').value = 'mineral'; initializeLayerUI();buildSeeds(); buildPads();
$('play').onclick = togglePlayback;
$('restart').onclick = () => enqueue('Restarting the seed…', reset).catch(() => {});
$('step').onclick = () => advanceSteps(100);
$('step-one').onclick = () => advanceSteps(1);
$('preset').onchange = () => {
  const preset = PRESETS[$('preset').value]; if (!preset) return;
  const apply = async () => { params = validateParams(preset); $('mode').value = params.mode; buildPads(); if (ready) await reset(); };
  if (ready) enqueue('Starting preset…', apply).catch(() => {}); else apply();
};
$('mode').onchange = () => {
  const mode = $('mode').value;
  const apply = async () => { params = { ...params, mode }; $('preset').value = ''; buildPads(); if (ready) await reset(); };
  if (ready) enqueue('Starting new model…', apply).catch(() => {}); else apply();
};
$('resolution').onchange = () => {
  const resolution = Number($('resolution').value);
  if (ready) enqueue('Changing resolution…', async () => { n = resolution; await reset(); }).catch(() => {});
  else n = resolution;
};
$('speed').oninput = () => setSpeed(sliderToSpeed(Number($('speed').value)));
$('speed-number').oninput = () => {
  const value = $('speed-number').valueAsNumber;
  if (Number.isInteger(value) && value >= MIN_SPEED && value <= MAX_SPEED) setSpeed(value);
};
$('speed-number').onchange = () => { setSpeed($('speed-number').valueAsNumber); $('speed-number').value = playback.rate; };
for (const button of document.querySelectorAll('[data-speed]')) button.onclick = () => setSpeed(Number(button.dataset.speed));
let savedSpeed = 120;
try { const value = Number(localStorage.getItem('cellularity-playback-speed')); if (Number.isInteger(value) && value >= MIN_SPEED && value <= MAX_SPEED) savedSpeed = value; } catch { /* Optional preference. */ }
setSpeed(savedSpeed);
$('view').onchange = () => setParameter('view', $('view').value);
$('palette').onchange = () => setParameter('palette', $('palette').value);
$('color-style').onchange=()=>setParameter('colorStyle',$('color-style').value);
$('kernel').onchange=()=>setParameter('kernel',$('kernel').value);
$('png').onclick = () => enqueue('Exporting the image…', exportPNG).catch(() => {});
$('save').onclick = () => enqueue('Saving the complete simulation…', saveState).catch(() => {});
$('load').onclick = () => { if (ready) $('load-file').click(); };
$('load-file').onchange = () => {
  const file = $('load-file').files[0]; $('load-file').value = ''; if (file) enqueue('Restoring state…', () => loadState(file)).catch(() => {});
};
$('cpu-fallback').onclick = () => enqueue('Starting CPU fallback…', () => boot(true)).catch(() => {});
$('notes-open').onclick = () => $('notes').showModal(); $('notes-close').onclick = () => $('notes').close();
document.addEventListener('visibilitychange', resetTiming);
addEventListener('keydown', event => {
  if (!ready || event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || $('notes').open) return;
  if (event.target instanceof Element && event.target.closest('input, select, textarea, button, [contenteditable]')) return;
  if (event.code === 'Space') { event.preventDefault(); if (!event.repeat) togglePlayback(); }
  else if (event.key === '.') { event.preventDefault(); if (!event.repeat) advanceSteps(1); }
  else if (event.key === '[' || event.key === ']') { event.preventDefault(); setSpeed(playback.rate * (event.key === '[' ? 0.5 : 2)); }
});
addEventListener('beforeunload', () => engine?.destroy());
requestAnimationFrame(tick); registerAgentTools();
await boot().catch(reportError);
