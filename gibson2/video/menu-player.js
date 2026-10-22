import {createKeyClicks} from './key-clicks.js';

// Load before swapping; generation tokens keep rapid hover/back navigation stable.
export function createImageMenu({states,transitions={},loadImage,present,showState=()=>{},reducedMotion=()=>false,setTimer=setTimeout,clearTimer=clearTimeout}){
 let current='menu',hovered=null,generation=0,timer=null,navigating=false;
 async function display(still,clip=null){
  const token=++generation;clearTimer(timer);
  const useClip=clip&&!reducedMotion();
  try{
   const image=await loadImage(useClip?clip.image:still);
   if(token!==generation)return;
   present(image);
   if(useClip)timer=setTimer(()=>{if(token===generation){navigating=false;display(still);}},clip.duration);
   else navigating=false;
  }catch{
   if(token!==generation)return;
   navigating=false;
   if(useClip)display(still);
  }
 }
 return {
  get state(){return current;},
  navigate(next,{animate=true}={}){
   if(!states[next])next='menu';
   const before=current;current=next;hovered=null;
   const clip=animate?transitions[`${before}:${next}`]:null;
   navigating=Boolean(clip&&!reducedMotion());showState(next,states[next]);display(states[next].still,clip);
  },
  hover(key){
   if(navigating)return;
   if(!states[current].hovers[key])key=null;
   if(key===hovered)return;
   const previous=states[current].hovers[hovered],next=states[current].hovers[key];hovered=key;
   display(next?.still??states[current].still,next?.enter??previous?.leave);
  },
  settle(){navigating=false;hovered=null;display(states[current].still);},
 };
}

export function startMenu(data){
 let foreground=document.querySelector('#menu-text');
 const background=document.querySelector('#tower-loop'),nav=document.querySelector('#image-links'),sound=document.querySelector('.sound');
 const blobs=new Map();
 async function loadImage(file){
  if(!blobs.has(file))blobs.set(file,fetch(`./video/${file}`).then(response=>{if(!response.ok)throw Error('Image unavailable');return response.blob();}).catch(error=>{blobs.delete(file);throw error;}));
  const url=URL.createObjectURL(await blobs.get(file)),image=new Image();image.src=url;
  try{await image.decode();}finally{URL.revokeObjectURL(url);}
  return image;
 }
 function present(image){
  // A fresh object URL gives every one-shot WebP its own animation timeline.
  image.id='menu-text';image.alt='';image.setAttribute('aria-hidden','true');
  foreground.replaceWith(image);foreground=image;
 }
 const audio=new Audio('./audio/gibson-techno.ogg');audio.loop=true;audio.volume=.7;
 let keyContext,keyOutput,keyClicks;
 function cue(kind,{activate=false}={}){
  if(!enabled)return;
  try{
   if(!keyContext){
    if(!activate)return;
    keyContext=new AudioContext();keyOutput=keyContext.createGain();keyOutput.gain.value=.7;keyOutput.connect(keyContext.destination);
    keyClicks=createKeyClicks(keyContext,keyOutput);
   }
   if(activate&&keyContext.state!=='running')keyContext.resume().then(()=>{if(enabled)keyClicks.play(kind);}).catch(()=>{});
   else if(keyContext.state==='running')Promise.resolve(keyClicks.play(kind)).catch(()=>{});
  }catch{/* Optional key feedback must not interrupt ordinary HTML navigation. */}
 }

 const motion=matchMedia('(prefers-reduced-motion:reduce)');let enabled=true;
 try{enabled=localStorage.getItem('gibson.audio.enabled')!=='false';}catch{}
 const keyFromHash=()=>Object.keys(data.states).find(key=>data.states[key].hash===location.hash)||'menu';
 const player=createImageMenu({states:data.states,transitions:data.transitions,loadImage,present,reducedMotion:()=>motion.matches,
  showState(key,state){
   nav.replaceChildren();
   for(const region of state.regions){
    const link=document.createElement('a');link.className='hit';link.href=region.href;link.dataset.key=region.key;
    link.style.cssText=`left:${region.left/640*100}%;top:${region.top/480*100}%;width:${region.pixelWidth/640*100}%;height:${region.pixelHeight/480*100}%`;
    const label=document.createElement('span');label.textContent=region.key==='return'?'Return to GARBAGE':region.key;link.append(label);nav.append(link);
   }
   document.querySelector('#status').textContent=key==='menu'?'GARBAGE directory':state.label;
  },
 });
 document.body.dataset.imageReady='true';
 const syncBackground=()=>{background.src=`./video/${motion.matches?data.backgroundStill:data.background}`;};
 syncBackground();
 function syncSound(){sound.textContent=enabled?'SOUND ON':'SOUND OFF';sound.setAttribute('aria-pressed',String(!enabled));sound.setAttribute('aria-label',enabled?'Mute sound':'Unmute sound');}
 sound.addEventListener('click',()=>{enabled=!enabled;try{localStorage.setItem('gibson.audio.enabled',String(enabled));}catch{}if(enabled)audio.play().catch(()=>{});else audio.pause();if(keyOutput)keyOutput.gain.setTargetAtTime(enabled?.7:0,keyContext.currentTime,.01);syncSound();});
 nav.addEventListener('click',event=>{
  const link=event.target.closest('a');if(!link||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
  const next=Object.keys(data.states).find(key=>data.states[key].hash===link.hash);if(!next)return;
  event.preventDefault();history.pushState(null,'',link.hash);
  // Native history and captured in-scene project navigation stay in sync.
  const keyboard=event.detail===0;player.navigate(next);if(keyboard)nav.querySelector('a')?.focus({preventScroll:true});if(enabled)audio.play().catch(()=>{});
 });
 const controls='a,button';
 document.addEventListener('pointerover',event=>{
  const control=event.target.closest(controls);if(control&&!control.contains(event.relatedTarget)){cue('hover');if(control.matches('.hit'))player.hover(control.dataset.key);}
 });
 document.addEventListener('focusin',event=>{if(event.target.matches(controls)&&event.target.matches(':focus-visible')){cue('hover');if(event.target.matches('.hit'))player.hover(event.target.dataset.key);}});
 nav.addEventListener('pointerout',event=>{if(!event.relatedTarget?.closest?.('.hit'))player.hover(null);});
 nav.addEventListener('pointerleave',()=>player.hover(nav.contains(document.activeElement)?document.activeElement.dataset.key:null));
 nav.addEventListener('focusout',event=>{if(!nav.contains(event.relatedTarget))player.hover(null);});
 document.addEventListener('click',event=>{if(event.target.closest(controls))cue('click',{activate:true});});
 window.addEventListener('pagehide',event=>{audio.pause();if(event.persisted)keyContext?.suspend();else{keyClicks?.dispose();keyContext?.close();}});
 window.addEventListener('pageshow',event=>{if(event.persisted&&enabled)keyContext?.resume().catch(()=>{});});
 window.addEventListener('hashchange',()=>player.navigate(keyFromHash()));
 document.addEventListener('visibilitychange',()=>{if(document.hidden){player.settle();audio.pause();keyContext?.suspend();}else{if(enabled)keyContext?.resume().catch(()=>{});}});
 motion.addEventListener('change',()=>{syncBackground();player.settle();});
 // A standalone fallback still makes the normal browser context request once.
 // An embedded fallback leaves that request to its original parent document.
 if(window.parent===window){
  const probe=document.createElement('canvas');probe.hidden=true;document.body.append(probe);
  const request=()=>{
   try{const gl=probe.getContext('webgl2');if(gl){gl.getExtension('WEBGL_lose_context')?.loseContext();location.replace(new URL('./',location.href));}}catch{}
  };
  request();window.addEventListener('focus',request);
 }
 syncSound();player.navigate(keyFromHash(),{animate:false});
}
