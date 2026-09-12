// Explicit unfilterable-float bindings keep rgba32float/rg32float portable without
// optional float32-filterable or read/write storage-texture features.
const bindings = {
  display:['sample'], growth:['sample','rgba32float'], horizontal:['sample','rg32float'],
  horizontalRepeat:['sample','rg32float'], vertical:['sample','rg32float'],
  lattice:['sample','rgba32float'], relayer:['sample','rgba32float'],
  turing:['sample','sample','rgba32float'], reduce:['sample','storage'],
  reduceFinal:['read-only-storage','storage'], normalize:['sample','read-only-storage','rgba32float'],
};
export function bindingEntries(name) {
  const visibility=name==='display'?3:4;
  return [{binding:0,visibility,buffer:{type:'uniform'}},...bindings[name].map((type,i)=>({binding:i+1,visibility,
    ...(type==='sample'?{texture:{sampleType:'unfilterable-float',viewDimension:'2d-array'}}:
      type.endsWith('float')?{storageTexture:{access:'write-only',format:type,viewDimension:'2d-array'}}:
      {buffer:{type}})}))];
}
