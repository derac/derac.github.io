const config = `
struct Config { v: array<vec4f, 128> }
@group(0) @binding(0) var<uniform> cfg: Config;
fn size() -> u32 { return u32(cfg.v[0].x); }
fn layers() -> u32 { return u32(cfg.v[0].w); }
fn linear(id: vec3u) -> u32 { return id.x + id.y * 65535u * 256u; }
fn pixel(x: i32, y: i32) -> u32 {
  let n=i32(size());var px=x;var py=y;
  if(px<0){px+=n;}else if(px>=n){px-=n;}
  if(py<0){py+=n;}else if(py>=n){py-=n;}
  return u32(py*n+px);
}
`;
export const growth = config + `
@group(0) @binding(1) var<storage, read> src: array<vec4f>;
@group(0) @binding(2) var<storage, read_write> dst: array<vec4f>;
@compute @workgroup_size(8, 8) fn main(@builtin(global_invocation_id) id: vec3u) {
  let n = size(); if (id.x >= n || id.y >= n) { return; }
  let center = f32(n - 1u) * 0.5;
  let p = (vec2f(id.xy) - center) * exp(-cfg.v[0].z) + center;
  let q = vec2i(floor(p)); let f = fract(p);
  for(var ch=0u;ch<4u;ch++){
    dst[(id.y * n + id.x)*4u+ch] = mix(mix(src[pixel(q.x, q.y)*4u+ch], src[pixel(q.x+1, q.y)*4u+ch], f.x),
      mix(src[pixel(q.x, q.y+1)*4u+ch], src[pixel(q.x+1, q.y+1)*4u+ch], f.x), f.y);
  }
}
`;
// Block-prefix scans use 256 shared entries at every resolution. Each lane sums
// a block, scans the block totals, then finishes boundary blocks on demand.
// This removes the old 1024-entry limit without allocating more shared memory.
function blurShader(kind) {
  const first=kind==='horizontal', vertical=kind==='vertical';
  const type=first?'f32':'vec2f';
  const address=vertical?'(s * n + u32(k)) * n + line':'(s * n + line) * n + u32(k)';
  return config + `
@group(0) @binding(1) var<storage, read> src: array<${first?'vec4f':'vec2f'}>;
@group(0) @binding(2) var<storage, read_write> dst: array<vec2f>;
var<workgroup> sums: array<${type}, 256>;
fn sampleAt(k: i32, line:u32, s:u32) -> ${type} {
  let n=size();return ${first?'src[(line * n + u32(k))*4u].x':`src[${address}]`};
}
fn prefix(x:i32,line:u32,s:u32) -> ${type} {
  let n=i32(size());var r=x;var periods=0.0;
  if(x<0){r=x+n;periods=-1.0;}else if(x>=n){r=x-n;periods=1.0;}
  let blockSize=(size()+255u)/256u;
  var result=periods*sums[255];
  let block=u32(r)/blockSize;
  if(block>0u){result+=sums[block-1u];}
  for(var k=block*blockSize;k<u32(r);k++){result+=sampleAt(i32(k),line,s);}
  return result;
}
@compute @workgroup_size(256) fn main(@builtin(local_invocation_index) lane:u32,@builtin(workgroup_id) group:vec3u) {
  let n=size();let line=group.x;let s=group.y;let blockSize=(n+255u)/256u;
  var sum=${type}(0.0);
  for(var k=lane*blockSize;k<min((lane+1u)*blockSize,n);k++){sum+=sampleAt(i32(k),line,s);}
  sums[lane]=sum;workgroupBarrier();
  for(var offset=1u;offset<256u;offset*=2u){
    var value=sums[lane];if(lane>=offset){value+=sums[lane-offset];}
    workgroupBarrier();sums[lane]=value;workgroupBarrier();
  }
  for(var k=lane;k<n;k+=256u){
    ${first?'for(var layer=0u;layer<layers();layer++){':'let layer=s;'}
    let radii=vec2i(cfg.v[64u+layer].xy);
    let a=(prefix(i32(k)+radii.x+1,line,s)${first?'':'.x'}-prefix(i32(k)-radii.x,line,s)${first?'':'.x'})/f32(2*radii.x+1);
    let b=(prefix(i32(k)+radii.y+1,line,s)${first?'':'.y'}-prefix(i32(k)-radii.y,line,s)${first?'':'.y'})/f32(2*radii.y+1);
    dst[${vertical?'(layer*n+k)*n+line':'(layer*n+line)*n+k'}]=vec2f(a,b);
    ${first?'}':''}
  }
}
`;
}
export const horizontal=blurShader('horizontal');
export const vertical=blurShader('vertical');
export const horizontalRepeat=blurShader('horizontalRepeat');
export const turing = config + `
@group(0) @binding(1) var<storage, read> src: array<f32>;
@group(0) @binding(2) var<storage, read> blurred: array<vec2f>;
@group(0) @binding(3) var<storage, read_write> dst: array<f32>;
@compute @workgroup_size(256) fn main(@builtin(global_invocation_id) id: vec3u) {
  let count=size()*size();let i=linear(id);if(i>=count){return;}
  let base=i*16u;let broad=blurred[(layers()-1u)*count+i].x;
  let region=clamp(broad*5.0,-1.0,1.0);
  var best=1e20;var winner=12u;var delta=0.0;
  for(var s=0u;s<layers();s++){
    if(cfg.v[64u+s].z<=0.0){continue;}
    let pair=blurred[s*count+i];let d=pair.x-pair.y;
    let score=abs(d)*cfg.v[64u+s].w*exp(-cfg.v[12].x*cfg.v[76u+s].x*region);
    if(score<best){best=score;winner=s;delta=d;}
  }
  for(var ch=0u;ch<16u;ch++){dst[base+ch]=src[base+ch];}
  if(winner==12u){return;}
  dst[base]=src[base]+select(-1.0,1.0,delta>0.0)*cfg.v[64u+winner].z;
  for(var s=0u;s<12u;s++){
    dst[base+1u+s]=select(0.0,mix(src[base+1u+s],select(0.0,1.0,s==winner),cfg.v[12].z),s<layers());
  }
  dst[base+13u]=mix(src[base+13u],broad,0.02);
}
`;
export const relayer = config + `
@group(0) @binding(1) var<storage, read> src: array<f32>;
@group(0) @binding(2) var<storage, read_write> dst: array<f32>;
@compute @workgroup_size(256) fn main(@builtin(global_invocation_id) id:vec3u) {
  let i=linear(id);if(i>=size()*size()){return;}let base=i*16u;
  for(var ch=0u;ch<16u;ch++){dst[base+ch]=src[base+ch];}
  if(cfg.v[0].y>0.5){return;}
  var total=0.0;
  for(var s=0u;s<12u;s++){
    var value=0.0;
    if(s<layers()) {let old=i32(cfg.v[32u+s/4u][s%4u]);if(old>=0){value=src[base+1u+u32(old)];}}
    dst[base+1u+s]=value;total+=value;
  }
  for(var s=0u;s<layers();s++){dst[base+1u+s]=select(1.0/f32(layers()),dst[base+1u+s]/max(total,1e-30),total>1e-30);}
}
`;
export const reduce = config + `
@group(0) @binding(1) var<storage, read> src: array<vec4f>;
@group(0) @binding(2) var<storage, read_write> dst: array<vec2f>;
var<workgroup> extrema: array<vec2f, 256>;
@compute @workgroup_size(256) fn main(@builtin(global_invocation_id) id: vec3u,
  @builtin(local_invocation_index) lane: u32, @builtin(workgroup_id) group: vec3u) {
  var v = vec2f(1e20, -1e20);
  if (linear(id) < size() * size()) { v = vec2f(src[linear(id)*4u].x); }
  extrema[lane] = v; workgroupBarrier();
  for (var stride = 128u; stride > 0u; stride /= 2u) {
    if (lane < stride) { let b = extrema[lane + stride]; extrema[lane] = vec2f(min(extrema[lane].x, b.x), max(extrema[lane].y, b.y)); }
    workgroupBarrier();
  }
  if (lane == 0u) { dst[group.x+group.y*65535u] = extrema[0]; }
}
`;
export const reduceFinal = config + `
@group(0) @binding(1) var<storage, read> src: array<vec2f>;
@group(0) @binding(2) var<storage, read_write> dst: array<vec2f>;
var<workgroup> extrema: array<vec2f, 256>;
@compute @workgroup_size(256) fn main(@builtin(local_invocation_index) lane: u32) {
  let count = (size() * size() + 255u) / 256u; var v = vec2f(1e20, -1e20);
  for (var i = lane; i < count; i += 256u) { let b = src[i]; v = vec2f(min(v.x, b.x), max(v.y, b.y)); }
  extrema[lane] = v; workgroupBarrier();
  for (var stride = 128u; stride > 0u; stride /= 2u) {
    if (lane < stride) { let b = extrema[lane + stride]; extrema[lane] = vec2f(min(extrema[lane].x, b.x), max(extrema[lane].y, b.y)); }
    workgroupBarrier();
  }
  if (lane == 0u) { dst[0] = extrema[0]; }
}
`;
export const normalize = config + `
@group(0) @binding(1) var<storage, read_write> field: array<vec4f>;
@group(0) @binding(2) var<storage, read> bounds: array<vec2f>;
@compute @workgroup_size(256) fn main(@builtin(global_invocation_id) id: vec3u) {
  if (linear(id) >= size() * size()) { return; }
  var totalAmount=0.0;for(var s=0u;s<layers();s++){totalAmount+=cfg.v[64u+s].z;}if(totalAmount<=0.0){return;}
  let range = bounds[0]; let q = field[linear(id)*4u];
  field[linear(id)*4u] = vec4f(2.0 * (q.x - range.x) / max(range.y - range.x, 1e-6) - 1.0, q.yzw);
}
`;
export const lattice = config + `
@group(0) @binding(1) var<storage, read> src: array<vec4f>;
@group(0) @binding(2) var<storage, read_write> dst: array<vec4f>;
@compute @workgroup_size(8, 8) fn main(@builtin(global_invocation_id) id: vec3u) {
  let n = size(); if (id.x >= n || id.y >= n) { return; }
  let x = i32(id.x); let y = i32(id.y); let i = (id.y * n + id.x)*4u; let q = src[i];let a=src[i+1u];
  dst[i+2u]=vec4f(0.0);dst[i+3u]=vec4f(0.0);
  let lap = src[pixel(x-1,y)*4u] + src[pixel(x+1,y)*4u] + src[pixel(x,y-1)*4u] + src[pixel(x,y+1)*4u] - 4.0*q;
  let lapA = src[pixel(x-1,y)*4u+1u] + src[pixel(x+1,y)*4u+1u] + src[pixel(x,y-1)*4u+1u] + src[pixel(x,y+1)*4u+1u] - 4.0*a;
  let f = clamp(cfg.v[1].x + cfg.v[1].w * cfg.v[2].y * (q.z - q.w)+cfg.v[12].y*0.012*a.x, 0.005, 0.09);
  let k = clamp(cfg.v[1].y + cfg.v[1].w * cfg.v[2].z * (q.w - 0.1)+cfg.v[12].y*(0.004*a.x+0.003*a.y), 0.025, 0.09);
  let uvv = q.x * q.y * q.y;
  dst[i] = clamp(q + vec4f(cfg.v[1].z * lap.x - uvv + f * (1.0-q.x),
    cfg.v[1].z * 0.5 * lap.y + uvv - (f+k)*q.y,
    0.03 * lap.z + cfg.v[2].x * cfg.v[2].w * (q.y-q.z),
    0.01 * lap.w + cfg.v[2].x * 0.25 * cfg.v[3].x * (q.z-q.w)), vec4f(0.0), vec4f(1.0));
  dst[i+1u]=vec4f(
    clamp(a.x+0.025*lapA.x+0.0005*a.x*(1.0-a.x*a.x)+0.001*cfg.v[12].y*(q.y-0.17),-1.0,1.0),
    clamp(a.y+0.015*lapA.y+0.0003*a.y*(1.0-a.y*a.y)+0.001*cfg.v[12].y*(q.z-q.w),-1.0,1.0),
    mix(a.z,q.y,cfg.v[12].z),mix(a.w,q.z,cfg.v[12].z));
}
`;
export const display = config + `
@group(0) @binding(1) var<storage, read> field: array<vec4f>;
@vertex fn vertex(@builtin(vertex_index) id: u32) -> @builtin(position) vec4f {
  let x=f32((id<<1u)&2u);let y=f32(id&2u);return vec4f(x*2.0-1.0,y*2.0-1.0,0.0,1.0);
}
fn height(i:u32)->f32 {let q=field[i*4u];return select(q.x*0.5+0.5,clamp(q.y*2.5,0.0,1.0),cfg.v[0].y>0.5);}
@fragment fn fragment(@builtin(position) pos:vec4f)->@location(0) vec4f {
  let viewport=cfg.v[15].yz;let uv=(pos.xy-viewport*0.5)/max(viewport.x,viewport.y)+0.5;
  let xy=vec2i(clamp(uv*f32(size()),vec2f(0.0),vec2f(f32(size()-1u))));let i=pixel(xy.x,xy.y);let q=field[i*4u];let a=field[i*4u+1u];
  let h=height(i);let isLattice=cfg.v[0].y>0.5;let view=u32(cfg.v[5].y);
  if(view==1u){return vec4f(vec3f(h),1.0);}
  if(view==3u){
    if(isLattice){return vec4f(clamp(q.xyz*vec3f(1.0,2.0,3.0),vec3f(0.0),vec3f(1.0)),1.0);}
    return vec4f(clamp(q.yzw+a.xyz,vec3f(0.0),vec3f(1.0)),1.0);
  }
  var weights:array<f32,12>;
  for(var s=0u;s<layers();s++){let ch=1u+s;weights[s]=field[i*4u+ch/4u][ch%4u];}
  if(isLattice){
    let coordinates=clamp(a.xy*0.75+vec2f(1.3,2.0)*(a.zw-vec2f(0.2,0.15)),vec2f(-1.0),vec2f(1.0));
    for(var s=0u;s<layers();s++){
      let angle=f32(s)*6.28318530718/f32(layers());let d=coordinates-vec2f(cos(angle),sin(angle))*0.7;
      weights[s]=exp(-2.0*dot(d,d));
    }
  }
  var total=0.0;
  for(var s=0u;s<layers();s++){weights[s]=pow(max(weights[s],0.00001),cfg.v[12].w);total+=weights[s];}
  var mean=0.0;for(var s=0u;s<layers();s++){weights[s]=select(1.0/f32(layers()),weights[s]/max(total,1e-30),total>1e-30);mean+=weights[s]*f32(s)/max(1.0,f32(layers()-1u));}
  let region=select(clamp(field[i*4u+3u].y*4.0,-1.0,1.0),a.x,isLattice);
  let region2=select(mean*2.0-1.0,a.y,isLattice);
  let tone=h*cfg.v[4].z+0.5*(1.0-cfg.v[4].z);
  let legacyPhase=fract(tone*cfg.v[4].y+cfg.v[5].x*select(mean,q.z*3.0,isLattice)+cfg.v[4].x);
  let position=legacyPhase*cfg.v[5].z;let index=u32(floor(position));let t=smoothstep(0.0,1.0,fract(position));
  let legacy=mix(cfg.v[16u+index].xyz,cfg.v[17u+index].xyz,t);
  var rgb=vec3f(0.0);let style=u32(cfg.v[5].w);
  if(view==2u){
    for(var s=0u;s<layers();s++){rgb+=weights[s]*cfg.v[89u+s*3u].xyz;}
  }else if(style==0u){rgb=legacy;}
  else if(style==2u){
    rgb=vec3f(
      0.5+0.5*sin(6.28318530718*(tone*cfg.v[4].y+cfg.v[4].x+region*cfg.v[13].x*0.31+cfg.v[14].x)),
      0.5+0.5*sin(6.28318530718*(tone*cfg.v[4].y*0.83+cfg.v[4].x+region2*cfg.v[13].x*0.41+cfg.v[14].y)),
      0.5+0.5*sin(6.28318530718*(tone*cfg.v[4].y*1.17+cfg.v[4].x+(region-region2)*cfg.v[13].x*0.23+cfg.v[14].z)));
    rgb=mix(legacy,rgb,cfg.v[5].x);
  }else{
    for(var s=0u;s<layers();s++){
      let level=0.5+0.5*sin(6.28318530718*(tone*cfg.v[4].y+cfg.v[4].x+cfg.v[76u+s].y+region*cfg.v[13].x*0.17));
      let low=mix(cfg.v[88u+s*3u].xyz,cfg.v[89u+s*3u].xyz,smoothstep(0.0,0.55,level));
      rgb+=weights[s]*mix(low,cfg.v[90u+s*3u].xyz,smoothstep(0.55,1.0,level));
    }
    rgb=mix(legacy,rgb,cfg.v[5].x);
  }
  if(view==0u){
    let luma=dot(rgb,vec3f(0.2126,0.7152,0.0722));rgb=mix(vec3f(luma),rgb,cfg.v[13].y);
    let dx=height(pixel(xy.x+1,xy.y))-height(pixel(xy.x-1,xy.y));
    let dy=height(pixel(xy.x,xy.y+1))-height(pixel(xy.x,xy.y-1));
    rgb*=clamp(1.0+cfg.v[4].w*(dx-dy)*2.5,0.35,1.6);
  }
  return vec4f(clamp(rgb,vec3f(0.0),vec3f(1.0)),1.0);
}
`;
