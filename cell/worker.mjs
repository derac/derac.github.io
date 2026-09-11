import { CPUModel, renderPixels } from './model.mjs';
let model;
self.onmessage = ({ data: m }) => {
  try {
    if (m.type === 'init') {
      model = new CPUModel(m.n, m.params, m.state); model.iteration = m.iteration || 0;
    } else if (m.type === 'step') model.step(m.params, m.count);
    else if (m.type === 'snapshot') {
      const state = model.field.slice();
      self.postMessage({ id: m.id, state: state.buffer, iteration: model.iteration }, [state.buffer]); return;
    }
    const pixels = renderPixels(model.field, model.n, m.params);
    self.postMessage({ id: m.id, pixels: pixels.buffer, iteration: model.iteration }, [pixels.buffer]);
  } catch (e) { self.postMessage({ id: m.id, error: e.message }); }
};
