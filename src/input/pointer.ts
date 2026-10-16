import { Vector2, Raycaster, Plane, Vector3, type PerspectiveCamera } from 'three';
import { Gestures } from './gestures.ts';
import { raycastProxies, type ProxyHit, type ProxyTarget } from '../interaction/proxies.ts';
import { HoldDrag } from '../interaction/hold-drag.ts';
import { TapFill } from '../interaction/tap-fill.ts';
import type { EventBus } from '../core/events.ts';
import type { Player } from '../scenes/player.ts';
import type { Settings } from './settings.ts';
export function installPointer(canvas: HTMLCanvasElement,camera: PerspectiveCamera,player: Player,targets: readonly ProxyTarget[],bus: EventBus,holding: HoldDrag,water: TapFill,settings: Settings): { step(dt:number):void; hit():ProxyHit|null; active(value:boolean):void; dispose():void } {
  const gestures=new Gestures(),raycaster=new Raycaster(),ndc=new Vector2(),surface=new Plane(new Vector3(0,1,0),-.85),point=new Vector3();
  const pointers=new Map<number,{x:number;y:number}>();let hit:ProxyHit|null=null,enabled=false,x=innerWidth/2,y=innerHeight/2,lastTarget='',menuShown=false,pinch=0;
  const updateHit=():void=>{const bounds=canvas.getBoundingClientRect();ndc.set((x-bounds.left)/bounds.width*2-1,-(y-bounds.top)/bounds.height*2+1);raycaster.setFromCamera(ndc,camera);hit=raycastProxies(raycaster.ray,targets,holding.id??'');};
  const showMenu=():void=>{if(hit?.target.kind==='object' && !holding.id){bus.emit('hover',{target:hit.target.id,x,y,actions:hit.target.actions});menuShown=true;}};
  const release=():void=>{
    if(holding.id){const id=holding.id;const nearHome=Math.hypot(holding.position.x-1.4,holding.position.z+.7)<.65;holding.release(hit?.target.kind==='floor'?'floor':'invalid',nearHome?1.4:holding.position.x,nearHome?-.7:holding.position.z);if(id==='water-bowl' && water.returnToStation(holding.position.x,holding.position.z))bus.emit('chore:done',{id:'water'});}
  };
  const down=(e:PointerEvent):void=>{
    if(!enabled)return;e.preventDefault();canvas.setPointerCapture(e.pointerId);pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});x=e.clientX;y=e.clientY;updateHit();lastTarget=hit?.target.id??'';bus.emit('hover',null);menuShown=false;
    const previous=gestures.state;gestures.toggle=settings.holdToggle;gestures.press(hit?.target.kind??'none',e.button===2,pointers.size);
    if(settings.holdToggle && previous==='hold'){release();return;}if(gestures.state==='hold' && hit)holding.start(hit.target.id);
  };
  const move=(e:PointerEvent):void=>{
    if(!enabled)return;const previous=pointers.get(e.pointerId);const dx=e.clientX-(previous?.x??e.clientX),dy=e.clientY-(previous?.y??e.clientY);x=e.clientX;y=e.clientY;updateHit();
    if(previous){pointers.set(e.pointerId,{x,y});const state=gestures.move(Math.hypot(dx,dy),pointers.size);if(state==='look')player.look(dx,dy);else if(state==='hold'){if(!holding.id)holding.start(lastTarget);}
      if(pointers.size>1){const values=[...pointers.values()];const a=values[0]!,b=values[1]!;const next=Math.hypot(a.x-b.x,a.y-b.y);if(pinch)player.lean=Math.max(-.2,Math.min(.3,player.lean+(next-pinch)*.001));pinch=next;}
    }else if(hit?.target.id!==lastTarget){gestures.reset();gestures.target=hit?.target.kind??'none';menuShown=false;bus.emit('hover',null);}
    lastTarget=hit?.target.id??'';
  };
  const up=(e:PointerEvent):void=>{if(!enabled)return;pointers.delete(e.pointerId);pinch=0;const result=gestures.release();if(result==='walk' && hit)player.walkTo(hit.point.x,hit.point.z);if(!settings.holdToggle)release();if(canvas.hasPointerCapture(e.pointerId))canvas.releasePointerCapture(e.pointerId);};
  const wheel=(e:WheelEvent):void=>{if(enabled){e.preventDefault();player.lean=Math.max(-.2,Math.min(.3,player.lean-e.deltaY*.0005));}};
  const context=(e:Event):void=>e.preventDefault();
  canvas.addEventListener('pointerdown',down);canvas.addEventListener('pointermove',move);canvas.addEventListener('pointerup',up);canvas.addEventListener('pointercancel',up);canvas.addEventListener('wheel',wheel,{passive:false});canvas.addEventListener('contextmenu',context);
  return {hit:()=>hit,active(value){enabled=value;if(!value){gestures.reset();pointers.clear();release();bus.emit('hover',null);}},step(dt){
    if(!enabled)return;gestures.holdMs=settings.holdMs;updateHit();gestures.tick(dt);if(gestures.state==='menu'&&!menuShown)showMenu();
    if(gestures.state==='move' && hit){player.walkTo(hit.point.x,hit.point.z);}
    if(holding.id){const under=hit?.target.id==='tap';if(under)holding.move(-2,1.12,-3.5);else if(raycaster.ray.intersectPlane(surface,point))holding.move(point.x,.85,point.z);const progress=water.step(dt,under&&holding.id==='water-bowl');if(under)bus.emit('chore:progress',{progress});}
  },dispose(){canvas.removeEventListener('pointerdown',down);canvas.removeEventListener('pointermove',move);canvas.removeEventListener('pointerup',up);canvas.removeEventListener('pointercancel',up);canvas.removeEventListener('wheel',wheel);canvas.removeEventListener('contextmenu',context);}};
}
