import { validateParams, CHANNELS, REGION_CHANNEL, initialField } from './model.mjs';
export function encodeState(state) {
  const bytes=new Uint8Array(state.buffer,state.byteOffset,state.byteLength);let text='';
  for(let i=0;i<bytes.length;i+=16384)text+=String.fromCharCode(...bytes.subarray(i,i+16384));
  return btoa(text);
}
function validateHeader(record,maxSize) {
  if(!record || record.format!=='cellularity-lab-state' || ![1,2,3].includes(record.version))throw Error('Unrecognized state file.');
  if(!Number.isInteger(record.n)||record.n<16||record.n>maxSize)throw Error(`This memory budget and backend allow state files up to ${maxSize} × ${maxSize}.`);
  if(!Number.isSafeInteger(record.iteration)||record.iteration<0)throw Error('Invalid iteration count.');
  return validateParams(record.params);
}
export function validFloats(state) {
  if(!state.every(v=>Number.isFinite(v)&&v>=-1.01&&v<=1.01))throw Error('Invalid numerical state.');
  return state;
}
export function decodeCheckpoint(record,maxSize=32768) {
  const params=validateHeader(record,maxSize), channels=record.version===1?4:record.version===2?8:CHANNELS;
  const expected=record.n*record.n*channels*4;
  if(record.encoding!=='float32-base64'||typeof record.state!=='string'||record.state.length!==4*Math.ceil(expected/3))throw Error('Invalid state length.');
  const text=atob(record.state);if(text.length!==expected)throw Error('Incomplete state file.');
  let state=validFloats(new Float32Array(Uint8Array.from(text,c=>c.charCodeAt(0)).buffer));
  if(record.version<3){
    params.layerCount=6;
    const migrated=new Float32Array(record.n*record.n*CHANNELS);
    if(record.version===1){params.regionality=0;params.regionVariation=0;params.colorStyle='legacy';params.kernel='box';params.separation=1;}
    for(let i=0;i<record.n*record.n;i++){
      const old=i*channels,j=i*CHANNELS;
      if(params.mode==='lattice')for(let ch=0;ch<channels;ch++)migrated[j+ch]=state[old+ch];
      else if(record.version===2){for(let ch=0;ch<7;ch++)migrated[j+ch]=state[old+ch];migrated[j+REGION_CHANNEL]=state[old+7];}
      else{
        migrated[j]=state[old];const position=Math.max(0,Math.min(5,state[old+1]*5)),low=Math.floor(position),high=Math.min(5,low+1);
        migrated[j+1+low]+=1-(position-low);migrated[j+1+high]+=position-low;
      }
    }
    // Version 1 regional fields did not exist; initialize them as in the old importer.
    if(record.version===1&&params.mode==='lattice'){
      const initial=initialField(record.n,params);for(let i=0;i<record.n*record.n;i++)for(let ch=4;ch<8;ch++)migrated[i*CHANNELS+ch]=initial[i*CHANNELS+ch];
    }
    state=migrated;
  }
  return {params,state,n:record.n,iteration:record.iteration,migrated:record.version===1};
}
const MAGIC=new TextEncoder().encode('CELLAB3\n');
export function checkpointHeader(n,params,iteration) {
  const json=new TextEncoder().encode(JSON.stringify({format:'cellularity-lab-state',version:3,encoding:'float32-le',n,params,iteration}));
  const header=new Uint8Array(12+json.length);header.set(MAGIC);new DataView(header.buffer).setUint32(8,json.length,true);header.set(json,12);return header;
}
export async function openCheckpoint(file,maxSize) {
  const prefix=new Uint8Array(await file.slice(0,12).arrayBuffer());
  if(prefix.length<12||!MAGIC.every((v,i)=>prefix[i]===v)){
    if(file.size>128*1024*1024)throw Error('Legacy JSON imports are limited to 128 MiB. Use a .cell checkpoint for larger fields.');
    return decodeCheckpoint(JSON.parse(await file.text()),maxSize);
  }
  const headerSize=new DataView(prefix.buffer).getUint32(8,true);
  if(headerSize>65536||headerSize<2)throw Error('Invalid checkpoint header.');
  const record=JSON.parse(await file.slice(12,12+headerSize).text()),params=validateHeader(record,maxSize);
  if(record.version!==3||record.encoding!=='float32-le'||file.size!==12+headerSize+record.n*record.n*CHANNELS*4)throw Error('Incomplete or unsupported checkpoint.');
  return {params,n:record.n,iteration:record.iteration,migrated:false,state:async(row,count)=>{
    const offset=12+headerSize+row*record.n*CHANNELS*4;
    return validFloats(new Float32Array(await file.slice(offset,offset+count*record.n*CHANNELS*4).arrayBuffer()));
  }};
}
