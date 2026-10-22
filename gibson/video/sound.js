import {createKeyClicks} from './key-clicks.js';
async function loadScore(context){
 const response=await fetch(`${new URL('../',import.meta.url).href}audio/gibson-techno.ogg`);
 if(!response.ok)throw new Error('Score could not load');
 return context.decodeAudioData(await response.arrayBuffer());
}
// One source persists across arrival, mute and rate changes. Loading/decoding
// happens asynchronously so the first interaction never synthesizes the score.
export function createSound(onFailure=()=>{},{loadBuffer=loadScore,createClicks=createKeyClicks}={}){
 let context,source,gain,loading,keys,effectGain,enabled=false,disposed=false;
 function fail(){enabled=false;onFailure();}
 return {
  get running(){return context?.state==='running';},
  async enable(value,rate=1){
   if(disposed)return false;
   enabled=value;
   if(effectGain)effectGain.gain.setTargetAtTime(value?.7:0,context.currentTime,.01);
   try{
    if(value&&!context){
     context=new AudioContext();gain=context.createGain();gain.gain.value=0;gain.connect(context.destination);
    }
    if(!context)return false;
    // Invoke resume in the click's call stack, before waiting for the asset.
    const resumed=value?context.resume():Promise.resolve();
    if(value&&!loading){
     loading=loadBuffer(context).then(buffer=>{
      if(disposed)return;
      source=context.createBufferSource();source.buffer=buffer;source.loop=true;
      source.playbackRate.value=rate;source.connect(gain);source.start();
     }).catch(error=>{loading=null;throw error;});
    }
    await Promise.all([resumed,loading]);
    if(!disposed)gain.gain.setTargetAtTime(enabled?.7:0,context.currentTime,.06);
    return enabled;
   }catch(error){
    if(error?.name==='NotAllowedError')return enabled;
    fail();return false;
   }
  },
  cue(kind){
   if(!enabled||!context||disposed)return;
   if(kind==='hover'&&context.state!=='running')return;
   try{
    if(!keys){effectGain=context.createGain();effectGain.connect(context.destination);keys=createClicks(context,effectGain);}
    effectGain.gain.setTargetAtTime(.7,context.currentTime,.01);Promise.resolve(keys.play(kind)).catch(()=>{});
   }catch{/* Optional feedback must never interrupt navigation or the score. */}
  },
  rate({duration,values}){
   if(!context||!source)return;
   const param=source.playbackRate,now=context.currentTime;
   try{
    // Interruptible linear segments approximate the same eased visual curve.
    // setValueCurveAtTime rejects a new curve overlapping an in-flight curve.
    param.cancelScheduledValues(now);
    param.setValueAtTime(values[0],now);
    if(duration>0)for(let i=1;i<values.length;i++)param.linearRampToValueAtTime(values[i],now+duration*i/(values.length-1));
   }catch{
    // Rate automation failure must never change the user's mute preference.
    try{param.cancelScheduledValues(now);param.setValueAtTime(values.at(-1),now);}catch{}
   }
  },
  async suspend(hidden){try{if(context){if(hidden)await context.suspend();else await context.resume();}}catch{fail();}},
  dispose(){disposed=true;keys?.dispose();source?.stop();context?.close().catch(()=>{});},
 };
}
