import { validateParams, CHANNELS, initialField } from './model.mjs';
export function encodeState(state) {
  const bytes = new Uint8Array(state.buffer, state.byteOffset, state.byteLength); let text = '';
  for (let i = 0; i < bytes.length; i += 16384) text += String.fromCharCode(...bytes.subarray(i, i + 16384));
  return btoa(text);
}
export function decodeCheckpoint(record, maxSize = 1024) {
  if (!record || record.format !== 'cellularity-lab-state' || ![1,2].includes(record.version) || record.encoding !== 'float32-base64') throw Error('Unrecognized state file.');
  if (![128, 256, 512, 1024].includes(record.n) || record.n > maxSize) throw Error(`This backend supports state files up to ${maxSize} × ${maxSize}.`);
  if (!Number.isSafeInteger(record.iteration) || record.iteration < 0) throw Error('Invalid iteration count.');
  const params = validateParams(record.params), expected = record.n * record.n * (record.version===1?4:CHANNELS)*4;
  if (typeof record.state !== 'string' || record.state.length !== 4 * Math.ceil(expected / 3)) throw Error('Invalid state length.');
  const text = atob(record.state); if (text.length !== expected) throw Error('Incomplete state file.');
  const bytes = Uint8Array.from(text, c => c.charCodeAt(0)); let state = new Float32Array(bytes.buffer);
  if (!state.every(v => Number.isFinite(v) && v >= -1.01 && v <= 1.01)) throw Error('Invalid numerical state.');
  if(record.version===1){
    params.regionality=0;params.regionVariation=0;params.colorStyle='legacy';params.kernel='box';params.separation=1;
    const migrated=initialField(record.n,params);
    for(let i=0;i<record.n*record.n;i++){
      const old=i*4,j=i*CHANNELS;
      if(params.mode==='lattice')for(let ch=0;ch<4;ch++)migrated[j+ch]=state[old+ch];
      else{
        migrated[j]=state[old];for(let s=0;s<6;s++)migrated[j+1+s]=0;
        const position=Math.max(0,Math.min(5,state[old+1]*5)),low=Math.floor(position),high=Math.min(5,low+1);
        migrated[j+1+low]+=1-(position-low);migrated[j+1+high]+=position-low;migrated[j+7]=0;
      }
    }
    state=migrated;
  }
  return { params, state, n: record.n, iteration: record.iteration, migrated:record.version===1 };
}
