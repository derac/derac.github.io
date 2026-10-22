import {createSound} from './sound-154efb87b006b38b.js';
import {installAudioStart} from './audio-start-761d805329a64f32.js';
// Navigation and hover are native HTML/CSS. JavaScript only owns audio lifecycle.
export function startMenu(){
 if(document.body.dataset.audioInitialized)return;
 document.body.dataset.audioInitialized='true';
 const audio=createSound();
 const stopAudioStart=installAudioStart(()=>{if(!audio.running)return audio.enable(true);});
 document.addEventListener('pointerover',event=>{const link=event.target.closest('a');if(link&&!link.contains(event.relatedTarget))audio.cue('hover');});
 document.addEventListener('focusin',event=>{if(event.target.matches('a:focus-visible'))audio.cue('hover');});
 document.addEventListener('click',event=>{if(event.target.closest('a'))audio.cue('click');});
 document.addEventListener('visibilitychange',()=>audio.suspend(document.hidden));
 window.addEventListener('pageshow',event=>{if(event.persisted)audio.suspend(document.hidden);});
 window.addEventListener('pagehide',event=>{if(event.persisted)audio.suspend(true);else{stopAudioStart();audio.dispose();}});
}
