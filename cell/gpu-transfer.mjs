// On disk and on the CPU: 16 adjacent floats per pixel. On the GPU: four vec4
// array layers. Align each row for WebGPU copies; keep transfers in small bands.
export const fieldRowPitch = width => Math.ceil(width*16/256)*256;
export function packFieldRows(field,width,rows) {
  const stride=fieldRowPitch(width)/4,packed=new Float32Array(stride*rows*4);
  for(let layer=0;layer<4;layer++)for(let y=0;y<rows;y++)for(let x=0;x<width;x++){
    const src=(y*width+x)*16+layer*4,dst=(layer*rows+y)*stride+x*4;
    for(let ch=0;ch<4;ch++)packed[dst+ch]=field[src+ch];
  }
  return packed;
}
export function unpackFieldRows(packed,width,rows,output=new Float32Array(width*rows*16),offset=0) {
  const stride=fieldRowPitch(width)/4;
  for(let layer=0;layer<4;layer++)for(let y=0;y<rows;y++)for(let x=0;x<width;x++){
    const src=(layer*rows+y)*stride+x*4,dst=offset+(y*width+x)*16+layer*4;
    for(let ch=0;ch<4;ch++)output[dst+ch]=packed[src+ch];
  }
  return output;
}
