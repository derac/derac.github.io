import {createSound} from './sound-154efb87b006b38b.js';
import {installAudioStart} from './audio-start-761d805329a64f32.js';

// Share in-flight and completed responses; never fetch again merely to replay a clip.
export function createAssetLoader(fetchAsset=globalThis.fetch){
 const assets=new Map();
 return file=>{
  if(!assets.has(file))assets.set(file,fetchAsset(`./video/${file}`,{cache:'force-cache'}).then(response=>{
   if(!response.ok)throw Error('Image unavailable');return response.blob();
  }).catch(error=>{assets.delete(file);throw error;}));
  return assets.get(file);
 };
}

// Some browser policies accept normal images but reject fetch/blob decoding.
// Keep the same HTTP URL as a fallback so navigation can still display its state.
export function createImageLoader({getAsset=createAssetLoader(),ImageClass=globalThis.Image,urlAPI=globalThis.URL}={}){
 async function decode(src,file){
  const image=new ImageClass();image.src=src;await image.decode();image.dataset.asset=file;return image;
 }
 return async file=>{
  let blob;
  try{blob=await getAsset(file);}catch{/* Direct images can still load under stricter fetch policies. */}
  return async()=>{
   if(blob){
    const url=urlAPI.createObjectURL(blob);
    try{
     const image=await decode(url,file);let released=false;
     image.release=()=>{if(!released){released=true;urlAPI.revokeObjectURL(url);}};
     return image;
    }catch{urlAPI.revokeObjectURL(url);/* Retry as a normal same-origin image. */}
   }
   return decode(`./video/${file}`,file);
  };
 };
}

// Load before swapping; generation tokens keep rapid hover/back navigation stable.
export function createImageMenu({states,transitions={},loadImage,present,showState=()=>{},reducedMotion=()=>false,setTimer=setTimeout,clearTimer=clearTimeout,onError=()=>{}}){
 let current='menu',hovered=null,generation=0,timer=null,navigating=false,pendingHover=null;
 const hoverLayers=new Set(),shownFiles=new Map();
 async function display(layers,onComplete=()=>{}){
  const token=++generation;clearTimer(timer);
  const animated=Object.values(layers).some(item=>item.clip)&&!reducedMotion();
  try{
   const resources=await Promise.all(Object.entries(layers).map(async([layer,item])=>{
    const file=animated&&item.clip?item.clip.image:item.still;
    if(shownFiles.has(layer)&&shownFiles.get(layer)===file&&!(animated&&item.clip))return null;
    return [layer,file?await loadImage(file):null,file];
   }));
   if(token!==generation)return;
   // Fetch every layer before creating its animation timeline. A small row
   // must not finish offscreen while a slower content clip downloads.
   const loaded=await Promise.all(resources.map(async result=>{
    if(result&&typeof result[1]==='function')result[1]=await result[1]();
    return result;
   }));
   if(token!==generation){for(const result of loaded)result?.[1]?.release?.();return;}
   for(const result of loaded){if(!result)continue;const [layer,image,file]=result;present(image,layer);shownFiles.set(layer,file);}
   if(animated){
    const duration=Math.max(...Object.values(layers).map(item=>item.clip?.duration??0));
    timer=setTimer(()=>{if(token===generation)display(Object.fromEntries(Object.entries(layers).map(([layer,item])=>[layer,{still:item.still}])),onComplete);},duration);
   }else onComplete();
  }catch(error){
   if(token!==generation)return;
   onError(error);
   if(animated)display(Object.fromEntries(Object.entries(layers).map(([layer,item])=>[layer,{still:item.still}])),onComplete);
   else navigating=false;
  }
 }
 function pageLayers(clip=null){
  const state=states[current];
  if(state.layers)return Object.fromEntries(Object.entries(state.layers).map(([layer,still])=>[layer,{still,clip:clip?.layers?.[layer]}]));
  const layers={content:{still:state.still,clip}};
  if('control' in state)layers.control={still:state.control,clip:clip?.control};
  return layers;
 }

 function finishNavigation(){
  navigating=false;
  player.hover(pendingHover);
 }
 const player={
  get state(){return current;},
  navigate(next,{animate=true}={}){
   if(!states[next])next='menu';
   const before=current;current=next;hovered=null;pendingHover=null;hoverLayers.clear();
   const clip=animate?transitions[`${before}:${next}`]:null;
   // Keep hover queued until every destination layer has settled, even without animation.
   navigating=true;showState(next,states[next]);display(pageLayers(clip),finishNavigation);
  },
  hover(key){
   if(!states[current].hovers[key])key=null;
   pendingHover=key;
   if(navigating)return;
   if(key===hovered)return;
   const previous=states[current].hovers[hovered],next=states[current].hovers[key];hovered=key;
   const layer=next?.layer??previous?.layer??'content';
   const base=id=>states[current].layers?.[id]??(id==='control'?states[current].control:states[current].still);
   hoverLayers.add(layer);if(previous?.layer)hoverLayers.add(previous.layer);
   const layers=Object.fromEntries([...hoverLayers].map(id=>[id,{still:base(id)}]));
   if(previous&&previous.layer!==next?.layer)layers[previous.layer??'content']={still:base(previous.layer??'content'),clip:previous.leave};
   layers[layer]={still:next?.still??base(layer),clip:next?.enter??previous?.leave};
   display(layers);
  },
  settle(){navigating=true;hovered=null;display(pageLayers(),finishNavigation);},
 };
 return player;
}

export function startMenu(data){
 if(document.body.dataset.imageInitialized==='true')return;
 document.body.dataset.imageInitialized='true';
 const foreground=Object.fromEntries([...document.querySelectorAll('[data-layer]')].map(image=>[image.dataset.layer,image]));
 const background=document.querySelector('#tower-loop'),nav=document.querySelector('#image-links');
 const loadImage=createImageLoader();
 function present(image,layer){
  document.body.dataset.imageReady='true';
  // A fresh object URL gives every one-shot WebP its own animation timeline.
  if(!image){foreground[layer].hidden=true;foreground[layer].release?.();return;}
  image.dataset.layer=layer;image.className='lettering';image.alt='';image.setAttribute('aria-hidden','true');
  const rect=data.assets?.[image.dataset.asset];
  if(rect)image.style.cssText=`left:${rect.x/640*100}%;top:${rect.y/480*100}%;width:${rect.width/640*100}%;height:${rect.height/480*100}%`;
  foreground[layer].release?.();foreground[layer].replaceWith(image);foreground[layer]=image;
 }
 const audio=createSound();
 const cue=kind=>audio.cue(kind);
 const motion=matchMedia('(prefers-reduced-motion:reduce)');
 const keyFromHash=()=>Object.keys(data.states).find(key=>data.states[key].hash===location.hash)||'menu';
 const player=createImageMenu({states:data.states,transitions:data.transitions,loadImage,present,reducedMotion:()=>motion.matches,onError:error=>{console.warn('GARBAGE image menu could not load a layer:',error);delete document.body.dataset.imageReady;},
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
 const syncBackground=()=>{const src=`./video/${motion.matches?data.backgroundStill:data.background}`;if(background.getAttribute('src')!==src)background.src=src;};
 syncBackground();
 nav.addEventListener('click',event=>{
  const link=event.target.closest('a');if(!link||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
  const next=Object.keys(data.states).find(key=>data.states[key].hash===link.hash);if(!next)return;
  event.preventDefault();history.pushState(null,'',link.hash);
  // Native history and captured in-scene project navigation stay in sync.
  const keyboard=event.detail===0;player.navigate(next);if(keyboard)nav.querySelector('a')?.focus({preventScroll:true});
 });
 const controls='a,button';
 document.addEventListener('pointerover',event=>{
  const control=event.target.closest(controls);if(control&&!control.contains(event.relatedTarget)){cue('hover');if(control.matches('.hit'))player.hover(control.dataset.key);}
 });
 document.addEventListener('focusin',event=>{if(event.target.matches(controls)&&event.target.matches(':focus-visible')){cue('hover');if(event.target.matches('.hit'))player.hover(event.target.dataset.key);}});
 nav.addEventListener('pointerout',event=>{if(!event.relatedTarget?.closest?.('.hit'))player.hover(null);});
 nav.addEventListener('pointerleave',()=>player.hover(nav.contains(document.activeElement)?document.activeElement.dataset.key:null));
 nav.addEventListener('focusout',event=>{if(!nav.contains(event.relatedTarget))player.hover(null);});
 document.addEventListener('click',event=>{if(event.target.closest(controls))cue('click');});
 const stopAudioStart=installAudioStart(()=>{if(!audio.running)return audio.enable(true);});
 window.addEventListener('pagehide',event=>{if(event.persisted)audio.suspend(true);else{stopAudioStart();audio.dispose();Object.values(foreground).forEach(image=>image.release?.());}});
 window.addEventListener('hashchange',()=>player.navigate(keyFromHash()));
 document.addEventListener('visibilitychange',()=>{if(document.hidden){player.settle();audio.suspend(true);}});
 motion.addEventListener('change',()=>{syncBackground();player.settle();});
 // A standalone fallback still makes the normal browser context request once.
 // An embedded fallback leaves that request to its original parent document.
 if(window.parent===window){
  const probe=document.createElement('canvas');probe.hidden=true;document.body.append(probe);
  const request=()=>{
   try{const gl=probe.getContext('webgl2');if(gl){gl.getExtension('WEBGL_lose_context')?.loseContext();location.replace(new URL('../',location.href));}}catch{}
  };
  request();window.addEventListener('focus',request);
 }
 player.navigate(keyFromHash(),{animate:false});
}
