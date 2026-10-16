import type { EventBus } from '../core/events.ts';
export function mountHoverMenu(bus: EventBus): { select(index:number):void } {
  const element=document.querySelector<HTMLElement>('#hover-menu')!; let target='',actions:readonly string[]=[];
  const select=(index:number):void=>{const action=actions[index];if(!action)return;bus.emit('action',{target,action});element.hidden=true;actions=[];};
  bus.on('hover',value=>{
    element.replaceChildren();element.hidden=!value;if(!value){actions=[];return;}target=value.target;actions=value.actions;
    element.style.left=`${Math.max(12,Math.min(innerWidth-220,value.x-100))}px`;
    const title=document.createElement('strong');title.textContent=value.target.replaceAll('-',' ');element.append(title);
    actions.forEach((action,index)=>{const button=document.createElement('button');let pressed=false;button.type='button';button.textContent=`${index+1}  ${action}`;
      // A touch that opens a menu must not also activate a new button beneath it.
      button.onpointerdown=()=>{pressed=true;};button.onpointercancel=()=>{pressed=false;};button.onclick=event=>{if(pressed||(event.detail===0&&!event.pointerType))select(index);pressed=false;};element.append(button);});
    const height=element.getBoundingClientRect().height,above=value.y-height-18;
    element.style.top=`${Math.max(12,Math.min(innerHeight-height-12,above>=12?above:value.y+18))}px`;
  });
  return {select};
}
