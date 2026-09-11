import { CPUModel, renderPixels, remapLayers, fieldRows } from './model.mjs';
let model;
self.onmessage = ({ data: m }) => {
  try {
    if (m.type === 'init') {
      const candidate = new CPUModel(m.n, m.params, m.state); candidate.iteration = m.iteration || 0; model = candidate;
    } else if (m.type === 'step') model.step(m.params, m.count);
    else if (m.type === 'layers') remapLayers(model.field,model.n,m.params,m.mapping);
    else if (m.type === 'rows' || m.type === 'snapshot') {
      const state=m.type==='rows'?fieldRows(model.field,model.n,m.row,m.count):model.field.slice();
      self.postMessage({id:m.id,state:state.buffer,iteration:model.iteration},[state.buffer]);return;
    }
    const pixels=renderPixels(model.field,model.n,m.params);
    self.postMessage({id:m.id,pixels:pixels.buffer,n:model.n,iteration:model.iteration},[pixels.buffer]);
  } catch(e) {self.postMessage({id:m.id,error:e.message});}
};
