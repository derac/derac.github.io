// Attempt permitted autoplay, then retry directly in trusted gesture stacks.
// A denied or still-pending autoplay attempt must not consume the gesture retry.
export function installAudioStart(start,{document:doc=globalThis.document,window:win=globalThis.window}={}){
 const attempt=event=>{
  if(doc.hidden||event?.repeat)return;
  try{Promise.resolve(start()).catch(()=>{});}catch{/* Audio never blocks navigation. */}
 };
 const gestures=['pointerdown','pointerup','touchend','keydown','click'];
 for(const name of gestures)doc.addEventListener(name,attempt,{capture:true,passive:true});
 doc.addEventListener('visibilitychange',attempt);win.addEventListener('pageshow',attempt);
 attempt();
 return ()=>{
  for(const name of gestures)doc.removeEventListener(name,attempt,{capture:true});
  doc.removeEventListener('visibilitychange',attempt);win.removeEventListener('pageshow',attempt);
 };
}
