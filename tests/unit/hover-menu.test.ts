import { expect,it,vi } from 'vitest';
import { EventBus } from '../../src/core/events.ts';
import { mountHoverMenu } from '../../src/ui/hover-menu.ts';
it('requires a fresh button press and positions actions clear of the opening touch',()=>{
 const children:Record<string,unknown>[]=[],element={style:{left:'',top:''},hidden:true,replaceChildren:()=>{children.length=0;},append:(node:Record<string,unknown>)=>children.push(node),getBoundingClientRect:()=>({height:120})};
 vi.stubGlobal('document',{querySelector:()=>element,createElement:()=>({})});vi.stubGlobal('innerWidth',863);vi.stubGlobal('innerHeight',360);
 try{const bus=new EventBus(),actions:string[]=[];bus.on('action',value=>actions.push(value.action));mountHoverMenu(bus);bus.emit('hover',{target:'water-bowl',x:430,y:180,actions:['Pick up']});const button=children[1] as unknown as HTMLButtonElement;
  button.onclick!({detail:1} as PointerEvent);expect(actions).toEqual([]);expect(Number.parseFloat(element.style.top)+120).toBeLessThan(180);
  button.onpointerdown!({} as PointerEvent);button.onclick!({detail:1} as PointerEvent);expect(actions).toEqual(['Pick up']);
 }finally{vi.unstubAllGlobals();}
});
