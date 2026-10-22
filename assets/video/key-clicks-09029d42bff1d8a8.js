// Actual CC0 IBM Model M recordings, with one shared dark room response.
// Attribution and extraction details: public/assets/audio/model-m/SOURCE.md.
export function createKeyClicks(context,output){
 const rate=context.sampleRate;
 let seed=95;
 const noise=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/2147483648-1;};
 const impulse=context.createBuffer(2,Math.ceil(rate*2.4),rate);
 for(let channel=0;channel<2;channel++){
  const data=impulse.getChannelData(channel);let low=0;
  for(let i=0;i<data.length;i++){
   const t=i/rate;low+=.16*(noise()-low);
   data[i]=t<.018?0:low*Math.exp(-t*2.8)*.65;
  }
 }
 const room=context.createConvolver();room.buffer=impulse;
 const wet=context.createGain();wet.gain.value=.38;room.connect(wet);wet.connect(output);
 let disposed=false,index=0;
 const recordings=Promise.all([1,2,3].map(async n=>{
  const response=await fetch(`${new URL('../../',import.meta.url).href}assets/audio/model-m/key-${n}.wav`);
  if(!response.ok)throw new Error('Key recording unavailable');
  return context.decodeAudioData(await response.arrayBuffer());
 })).catch(()=>[]);
 let lastHover=-Infinity;
 return {
  async play(kind){
   const now=context.currentTime;
   if(kind==='hover'&&now-lastHover<.09)return;
   if(kind==='hover')lastHover=now;
   const buffers=await recordings;
   if(disposed||!buffers.length||context.currentTime-now>.3)return;
   const source=context.createBufferSource(),level=context.createGain();
   source.buffer=buffers[index++%buffers.length];source.playbackRate.value=1;
   level.gain.value=kind==='hover'?.12:.26;
   source.connect(level);level.connect(output);level.connect(room);
   source.onended=()=>{source.disconnect();level.disconnect();};source.start();
  },
  dispose(){disposed=true;room.disconnect();wet.disconnect();},
 };
}
