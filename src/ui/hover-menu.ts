import type { EventBus } from '../core/events.ts';
export function mountHoverMenu(bus: EventBus): { select(index:number):void } {
  const element=document.querySelector<HTMLElement>('#hover-menu')!; let target='',actions:readonly string[]=[];
  const select=(index:number):void=>{const action=actions[index];if(!action)return;bus.emit('action',{target,action});element.hidden=true;actions=[];};
  bus.on('hover',value=>{
    element.replaceChildren();element.hidden=!value;if(!value){actions=[];return;}target=value.target;actions=value.actions;
    element.style.left=`${Math.max(12,Math.min(innerWidth-220,value.x-100))}px`;element.style.top=`${Math.max(12,Math.min(innerHeight-180,value.y-45))}px`;
    const title=document.createElement('strong');title.textContent=value.target.replaceAll('-',' ');element.append(title);
    actions.forEach((action,index)=>{const button=document.createElement('button');button.type='button';button.textContent=`${index+1}  ${action}`;button.onclick=()=>select(index);element.append(button);});
  });
  return {select};
}
