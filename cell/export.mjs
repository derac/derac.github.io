import { CHANNELS, renderPixels } from './model.mjs';
import { checkpointHeader } from './state.mjs';
export const BLOB_LIMIT=128*1024*1024;
const crcTable=Uint32Array.from({length:256},(_,n)=>{for(let k=0;k<8;k++)n=(n&1)?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
export function pngChunk(type,data=new Uint8Array()) {
  const bytes=new Uint8Array(12+data.length),view=new DataView(bytes.buffer);view.setUint32(0,data.length);
  bytes.set(new TextEncoder().encode(type),4);bytes.set(data,8);let crc=0xffffffff;
  for(let i=4;i<bytes.length-4;i++)crc=crcTable[(crc^bytes[i])&255]^(crc>>>8);
  view.setUint32(bytes.length-4,(crc^0xffffffff)>>>0);return bytes;
}
export async function writePNG(engine,n,params,sink,{signal,onProgress=()=>{}}={}) {
  if(typeof CompressionStream==='undefined')throw Error('This browser needs Compression Streams support for PNG export.');
  signal?.throwIfAborted();
  await sink.write(new Uint8Array([137,80,78,71,13,10,26,10]));
  const header=new Uint8Array(13),view=new DataView(header.buffer);view.setUint32(0,n);view.setUint32(4,n);header[8]=8;header[9]=6;
  await sink.write(pngChunk('IHDR',header));
  let row=0;const rows=Math.max(1,Math.floor(2*1024*1024/(n*CHANNELS*4)));
  const raw=new ReadableStream({async pull(controller){
    try {
      signal?.throwIfAborted();if(row>=n){controller.close();return;}
      const count=Math.min(rows,n-row),field=await engine.readRows(row-1,count+2);
      const pixels=renderPixels(field,n,params,{rowStart:1,rowCount:count,rows:count+2});
      const scanlines=new Uint8Array((n*4+1)*count);
      for(let y=0;y<count;y++)scanlines.set(pixels.subarray(y*n*4,(y+1)*n*4),y*(n*4+1)+1);
      controller.enqueue(scanlines);row+=count;onProgress(row/n);
      // Yield between bands so cancellation and controls stay responsive on the main thread.
      await new Promise(resolve=>setTimeout(resolve,0));
    }catch(error){controller.error(error);}
  }});
  const reader=raw.pipeThrough(new CompressionStream('deflate')).getReader();
  try {while(true){signal?.throwIfAborted();const {value,done}=await reader.read();if(done)break;await sink.write(pngChunk('IDAT',value));}}
  catch(error){await reader.cancel(error).catch(()=>{});throw error;}
  finally{reader.releaseLock();}
  await sink.write(pngChunk('IEND'));await sink.close();
}
export async function writeCheckpoint(engine,n,params,sink,{signal,onProgress=()=>{}}={}) {
  await sink.write(checkpointHeader(n,params,engine.iteration));
  const rows=Math.max(1,Math.floor(4*1024*1024/(n*CHANNELS*4)));
  for(let row=0;row<n;row+=rows){
    signal?.throwIfAborted();const count=Math.min(rows,n-row),state=await engine.readRows(row,count);
    await sink.write(new Uint8Array(state.buffer,state.byteOffset,state.byteLength));onProgress((row+count)/n);
    await new Promise(resolve=>setTimeout(resolve,0));
  }
  await sink.close();
}
// File System Access streams directly to disk. Other browsers use an explicitly
// bounded Blob, never an unbounded fallback that silently consumes all RAM.
export async function createSink(filename,mime,estimatedBytes,download) {
  if(globalThis.showSaveFilePicker){
    const handle=await showSaveFilePicker({suggestedName:filename});return handle.createWritable();
  }
  if(estimatedBytes>BLOB_LIMIT)throw Error('This export exceeds the 128 MiB download buffer. Use a browser with Save File support (such as Chrome or Edge), or reduce resolution.');
  let parts=[],size=0;
  return {async write(bytes){size+=bytes.byteLength;if(size>BLOB_LIMIT)throw Error('Download buffer limit reached. Use a browser with Save File support.');parts.push(bytes);},async close(){download(new Blob(parts,{type:mime}),filename);parts=[];},async abort(){parts=[];}};
}
