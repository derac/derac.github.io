const config = `
struct Config { v: array<vec4f, 64> }
@group(0) @binding(0) var<uniform> cfg: Config;
fn size() -> u32 { return u32(cfg.v[0].x); }
fn pixel(x: i32, y: i32) -> u32 {
  let n = i32(size()); return u32(((y % n + n) % n) * n + (x % n + n) % n);
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
  for(var ch=0u;ch<2u;ch++){
    dst[(id.y * n + id.x)*2u+ch] = mix(mix(src[pixel(q.x, q.y)*2u+ch], src[pixel(q.x+1, q.y)*2u+ch], f.x),
      mix(src[pixel(q.x, q.y+1)*2u+ch], src[pixel(q.x+1, q.y+1)*2u+ch], f.x), f.y);
  }
}
`;
export const horizontal = config + `
@group(0) @binding(1) var<storage, read> src: array<vec4f>;
@group(0) @binding(2) var<storage, read_write> dst: array<vec2f>;
var<workgroup> sums: array<f32, 1024>;
fn prefix(x: i32) -> f32 {
  let n = i32(size()); let r = (x % n + n) % n;
  var value = f32((x - r) / n) * sums[u32(n - 1)];
  if (r > 0) { value += sums[u32(r - 1)]; } return value;
}
fn average(x: i32, radius: i32) -> f32 {
  return (prefix(x + radius + 1) - prefix(x - radius)) / f32(2 * radius + 1);
}
@compute @workgroup_size(256) fn main(@builtin(local_invocation_index) lane: u32, @builtin(workgroup_id) group: vec3u) {
  let n = size(); let y = group.x;
  for (var k = 0u; k < 4u; k++) {
    let x = lane + 256u * k; sums[x] = 0.0;
    if (x < n) { sums[x] = src[(y * n + x)*2u].x; }
  }
  workgroupBarrier();
  for (var offset = 1u; offset < n; offset *= 2u) {
    var values: array<f32, 4>;
    for (var k = 0u; k < 4u; k++) {
      let x = lane + 256u * k; values[k] = sums[x];
      if (x >= offset) { values[k] += sums[x - offset]; }
    }
    workgroupBarrier();
    for (var k = 0u; k < 4u; k++) { sums[lane + 256u * k] = values[k]; }
    workgroupBarrier();
  }
  for (var k = 0u; k < 4u; k++) {
    let x = lane + 256u * k;
    if (x < n) {
      for (var s = 0u; s < 6u; s++) {
        let radii = vec2i(cfg.v[6u + s].xy);
        dst[(s * n + y) * n + x] = vec2f(average(i32(x), radii.x), average(i32(x), radii.y));
      }
    }
  }
}
`;
export const vertical = config + `
@group(0) @binding(1) var<storage, read> src: array<vec2f>;
@group(0) @binding(2) var<storage, read_write> dst: array<vec2f>;
var<workgroup> sums: array<vec2f, 1024>;
fn prefix(x: i32) -> vec2f {
  let n = i32(size()); let r = (x % n + n) % n;
  var value = f32((x - r) / n) * sums[u32(n - 1)];
  if (r > 0) { value += sums[u32(r - 1)]; } return value;
}
@compute @workgroup_size(256) fn main(@builtin(local_invocation_index) lane: u32, @builtin(workgroup_id) group: vec3u) {
  let n = size(); let x = group.x; let s = group.y;
  for (var k = 0u; k < 4u; k++) {
    let y = lane + 256u * k; sums[y] = vec2f(0.0);
    if (y < n) { sums[y] = src[(s * n + y) * n + x]; }
  }
  workgroupBarrier();
  for (var offset = 1u; offset < n; offset *= 2u) {
    var values: array<vec2f, 4>;
    for (var k = 0u; k < 4u; k++) {
      let y = lane + 256u * k; values[k] = sums[y];
      if (y >= offset) { values[k] += sums[y - offset]; }
    }
    workgroupBarrier();
    for (var k = 0u; k < 4u; k++) { sums[lane + 256u * k] = values[k]; }
    workgroupBarrier();
  }
  let radii = vec2i(cfg.v[6u + s].xy);
  for (var k = 0u; k < 4u; k++) {
    let y = lane + 256u * k;
    if (y < n) {
      let a = (prefix(i32(y) + radii.x + 1).x - prefix(i32(y) - radii.x).x) / f32(2 * radii.x + 1);
      let b = (prefix(i32(y) + radii.y + 1).y - prefix(i32(y) - radii.y).y) / f32(2 * radii.y + 1);
      dst[(s * n + y) * n + x] = vec2f(a, b);
    }
  }
}
`;
export const horizontalRepeat = config + `
@group(0) @binding(1) var<storage, read> src: array<vec2f>;
@group(0) @binding(2) var<storage, read_write> dst: array<vec2f>;
var<workgroup> sums: array<vec2f, 1024>;
fn prefix(x: i32) -> vec2f {
  let n = i32(size()); let r = (x % n + n) % n;
  var value = f32((x - r) / n) * sums[u32(n - 1)];
  if (r > 0) { value += sums[u32(r - 1)]; } return value;
}
@compute @workgroup_size(256) fn main(@builtin(local_invocation_index) lane: u32, @builtin(workgroup_id) group: vec3u) {
  let n = size(); let row = group.x; let s = group.y;
  for (var k = 0u; k < 4u; k++) {
    let y = lane + 256u * k; sums[y] = vec2f(0.0);
    if (y < n) { sums[y] = src[(s * n + row) * n + y]; }
  }
  workgroupBarrier();
  for (var offset = 1u; offset < n; offset *= 2u) {
    var values: array<vec2f, 4>;
    for (var k = 0u; k < 4u; k++) {
      let y = lane + 256u * k; values[k] = sums[y];
      if (y >= offset) { values[k] += sums[y - offset]; }
    }
    workgroupBarrier();
    for (var k = 0u; k < 4u; k++) { sums[lane + 256u * k] = values[k]; }
    workgroupBarrier();
  }
  let radii = vec2i(cfg.v[6u + s].xy);
  for (var k = 0u; k < 4u; k++) {
    let y = lane + 256u * k;
    if (y < n) {
      let a = (prefix(i32(y) + radii.x + 1).x - prefix(i32(y) - radii.x).x) / f32(2 * radii.x + 1);
      let b = (prefix(i32(y) + radii.y + 1).y - prefix(i32(y) - radii.y).y) / f32(2 * radii.y + 1);
      dst[(s * n + row) * n + y] = vec2f(a, b);
    }
  }
}
`;
export const turing = config + `
@group(0) @binding(1) var<storage, read> src: array<vec4f>;
@group(0) @binding(2) var<storage, read> blurred: array<vec2f>;
@group(0) @binding(3) var<storage, read_write> dst: array<vec4f>;
@compute @workgroup_size(256) fn main(@builtin(global_invocation_id) id: vec3u) {
  let count = size() * size(); let i = id.x; if (i >= count) { return; }
  var best = 1e20; var winner = 6u; var delta = 0.0;
  let region = clamp(blurred[5u*count+i].x*5.0,-1.0,1.0);
  for (var s = 0u; s < 6u; s++) {
    if(cfg.v[6u+s].z<=0.0){continue;}
    let pair = blurred[s * count + i]; let d = pair.x - pair.y;
    let score = abs(d) * cfg.v[6u + s].w * exp(-cfg.v[12].x*cfg.v[50u+s].x*region);
    if (score < best) { best = score; winner = s; delta = d; }
  }
  let q = src[i*2u];let a=src[i*2u+1u];
  if(winner==6u){dst[i*2u]=q;dst[i*2u+1u]=a;return;}
  let memory=cfg.v[12].z;
  var weights=array<f32,6>(q.y,q.z,q.w,a.x,a.y,a.z);
  for(var s=0u;s<6u;s++){weights[s]=mix(weights[s],select(0.0,1.0,s==winner),memory);}
  dst[i*2u]=vec4f(q.x + select(-1.0, 1.0, delta > 0.0) * cfg.v[6u + winner].z,weights[0],weights[1],weights[2]);
  dst[i*2u+1u]=vec4f(weights[3],weights[4],weights[5],mix(a.w,blurred[5u*count+i].x,0.02));
}
`;
export const reduce = config + `
@group(0) @binding(1) var<storage, read> src: array<vec4f>;
@group(0) @binding(2) var<storage, read_write> dst: array<vec2f>;
var<workgroup> extrema: array<vec2f, 256>;
@compute @workgroup_size(256) fn main(@builtin(global_invocation_id) id: vec3u,
  @builtin(local_invocation_index) lane: u32, @builtin(workgroup_id) group: vec3u) {
  var v = vec2f(1e20, -1e20);
  if (id.x < size() * size()) { v = vec2f(src[id.x*2u].x); }
  extrema[lane] = v; workgroupBarrier();
  for (var stride = 128u; stride > 0u; stride /= 2u) {
    if (lane < stride) { let b = extrema[lane + stride]; extrema[lane] = vec2f(min(extrema[lane].x, b.x), max(extrema[lane].y, b.y)); }
    workgroupBarrier();
  }
  if (lane == 0u) { dst[group.x] = extrema[0]; }
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
  if (id.x >= size() * size()) { return; }
  var totalAmount=0.0;for(var s=0u;s<6u;s++){totalAmount+=cfg.v[6u+s].z;}if(totalAmount<=0.0){return;}
  let range = bounds[0]; let q = field[id.x*2u];
  field[id.x*2u] = vec4f(2.0 * (q.x - range.x) / max(range.y - range.x, 1e-6) - 1.0, q.yzw);
}
`;
export const lattice = config + `
@group(0) @binding(1) var<storage, read> src: array<vec4f>;
@group(0) @binding(2) var<storage, read_write> dst: array<vec4f>;
@compute @workgroup_size(8, 8) fn main(@builtin(global_invocation_id) id: vec3u) {
  let n = size(); if (id.x >= n || id.y >= n) { return; }
  let x = i32(id.x); let y = i32(id.y); let i = (id.y * n + id.x)*2u; let q = src[i];let a=src[i+1u];
  let lap = src[pixel(x-1,y)*2u] + src[pixel(x+1,y)*2u] + src[pixel(x,y-1)*2u] + src[pixel(x,y+1)*2u] - 4.0*q;
  let lapA = src[pixel(x-1,y)*2u+1u] + src[pixel(x+1,y)*2u+1u] + src[pixel(x,y-1)*2u+1u] + src[pixel(x,y+1)*2u+1u] - 4.0*a;
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
fn height(i:u32)->f32 {let q=field[i*2u];return select(q.x*0.5+0.5,clamp(q.y*2.5,0.0,1.0),cfg.v[0].y>0.5);}
@fragment fn fragment(@builtin(position) pos:vec4f)->@location(0) vec4f {
  let xy=vec2i(pos.xy);let i=pixel(xy.x,xy.y);let q=field[i*2u];let a=field[i*2u+1u];
  let h=height(i);let isLattice=cfg.v[0].y>0.5;let view=u32(cfg.v[5].y);
  if(view==1u){return vec4f(vec3f(h),1.0);}
  if(view==3u){
    if(isLattice){return vec4f(clamp(q.xyz*vec3f(1.0,2.0,3.0),vec3f(0.0),vec3f(1.0)),1.0);}
    return vec4f(clamp(q.yzw+a.xyz,vec3f(0.0),vec3f(1.0)),1.0);
  }
  var weights=array<f32,6>(q.y,q.z,q.w,a.x,a.y,a.z);
  if(isLattice){
    let coordinates=clamp(a.xy*0.75+vec2f(1.3,2.0)*(a.zw-vec2f(0.2,0.15)),vec2f(-1.0),vec2f(1.0));
    for(var s=0u;s<6u;s++){
      let angle=f32(s)*1.0471975512;let d=coordinates-vec2f(cos(angle),sin(angle))*0.7;
      weights[s]=exp(-2.0*dot(d,d));
    }
  }
  var total=0.0;
  for(var s=0u;s<6u;s++){weights[s]=pow(max(weights[s],0.00001),cfg.v[12].w);total+=weights[s];}
  var mean=0.0;for(var s=0u;s<6u;s++){weights[s]=select(1.0/6.0,weights[s]/max(total,1e-30),total>1e-30);mean+=weights[s]*f32(s)/5.0;}
  let region=select(clamp(a.w*4.0,-1.0,1.0),a.x,isLattice);
  let region2=select(mean*2.0-1.0,a.y,isLattice);
  let tone=h*cfg.v[4].z+0.5*(1.0-cfg.v[4].z);
  let legacyPhase=fract(tone*cfg.v[4].y+cfg.v[5].x*select(mean,q.z*3.0,isLattice)+cfg.v[4].x);
  let position=legacyPhase*cfg.v[5].z;let index=u32(floor(position));let t=smoothstep(0.0,1.0,fract(position));
  let legacy=mix(cfg.v[16u+index].xyz,cfg.v[17u+index].xyz,t);
  var rgb=vec3f(0.0);let style=u32(cfg.v[5].w);
  if(view==2u){
    for(var s=0u;s<6u;s++){rgb+=weights[s]*cfg.v[33u+s*3u].xyz;}
  }else if(style==0u){rgb=legacy;}
  else if(style==2u){
    rgb=vec3f(
      0.5+0.5*sin(6.28318530718*(tone*cfg.v[4].y+cfg.v[4].x+region*cfg.v[13].x*0.31+cfg.v[14].x)),
      0.5+0.5*sin(6.28318530718*(tone*cfg.v[4].y*0.83+cfg.v[4].x+region2*cfg.v[13].x*0.41+cfg.v[14].y)),
      0.5+0.5*sin(6.28318530718*(tone*cfg.v[4].y*1.17+cfg.v[4].x+(region-region2)*cfg.v[13].x*0.23+cfg.v[14].z)));
    rgb=mix(legacy,rgb,cfg.v[5].x);
  }else{
    for(var s=0u;s<6u;s++){
      let level=0.5+0.5*sin(6.28318530718*(tone*cfg.v[4].y+cfg.v[4].x+cfg.v[50u+s].y+region*cfg.v[13].x*0.17));
      let low=mix(cfg.v[32u+s*3u].xyz,cfg.v[33u+s*3u].xyz,smoothstep(0.0,0.55,level));
      rgb+=weights[s]*mix(low,cfg.v[34u+s*3u].xyz,smoothstep(0.55,1.0,level));
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
