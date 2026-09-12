// Immediate-mode DOM adapter: call widgets every frame with application-owned values.
// Events are consumed once by the next frame. Keyed DOM nodes retain focus, selection,
// accessibility and native input behavior; no widget owns the experiment state.
export class ImmediateGUI {
  constructor(root) { this.root=root;this.nodes=new Map();this.events=new Map(); }
  begin() { this.seen=new Set();this.cursor=this.root.firstChild; }
  widget(id, make) {
    this.seen.add(id);
    if(!this.nodes.has(id)){const node=make();this.nodes.set(id,node);this.root.append(node);}
    const node=this.nodes.get(id);if(node!==this.cursor)this.root.insertBefore(node,this.cursor);this.cursor=node.nextSibling;return node;
  }
  number(id,label,value,{min,max,step=1,disabled=false}={}) {
    const row=this.widget(id,()=>{
      const row=document.createElement('label');row.className='gui-row';
      const title=document.createElement('span');title.textContent=label;
      const input=document.createElement('input');input.type='number';input.setAttribute('aria-label',label);
      input.addEventListener('input',()=>{if(input.checkValidity()&&Number.isFinite(input.valueAsNumber))this.events.set(id,input.valueAsNumber);});
      input.addEventListener('change',()=>{if(input.checkValidity()&&Number.isFinite(input.valueAsNumber))this.events.set(id,input.valueAsNumber);else input.value=input.lastValue;});
      row.append(title,input);return row;
    });
    const input=row.lastChild;input.lastValue=value;input.min=min??'';input.max=max??'';input.step=step;input.disabled=disabled;
    if(document.activeElement!==input)input.value=value;
    const next=this.events.has(id)?this.events.get(id):value;this.events.delete(id);return disabled?value:next;
  }
  toggle(id,label,value,{disabled=false}={}) {
    const row=this.widget(id,()=>{const row=document.createElement('label');row.className='gui-row';const title=document.createElement('span');title.textContent=label;
      const input=document.createElement('input');input.type='checkbox';input.onchange=()=>this.events.set(id,input.checked);row.append(title,input);return row;});
    row.lastChild.checked=value;row.lastChild.disabled=disabled;const next=this.events.has(id)?this.events.get(id):value;this.events.delete(id);return disabled?value:next;
  }
  button(id,label,{disabled=false}={}) {
    const button=this.widget(id,()=>{const b=document.createElement('button');b.onclick=()=>this.events.set(id,true);return b;});
    button.textContent=label;button.disabled=disabled;const clicked=this.events.get(id);this.events.delete(id);return !disabled&&clicked;
  }
  text(id,text) {const node=this.widget(id,()=>{const p=document.createElement('p');p.className='microcopy';return p;});if(node.textContent!==text)node.textContent=text;}
  end() {for(const [id,node] of this.nodes)if(!this.seen.has(id)){node.remove();this.nodes.delete(id);this.events.delete(id);}}
}
