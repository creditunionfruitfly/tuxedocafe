import { Vector2, Vector3, Raycaster, type PerspectiveCamera } from 'three';
import { Gestures } from './gestures.ts';
import { DoubleTap } from './double-tap.ts';
import { INTERACTION_REACH, raycastProxies, withinReach, type ProxyHit, type ProxyTarget } from '../interaction/proxies.ts';
import { HoldDrag } from '../interaction/hold-drag.ts';
import { TapFill } from '../interaction/tap-fill.ts';
import { radialRate } from './radial.ts';
import type { EventBus } from '../core/events.ts';
import type { Player } from '../scenes/player.ts';
import type { Settings } from './settings.ts';
import controls from '../../data/interaction.json' with { type: 'json' };
export function installPointer(canvas: HTMLCanvasElement,camera: PerspectiveCamera,player: Player,targets: readonly ProxyTarget[],bus: EventBus,holding: HoldDrag,water: TapFill,settings: Settings): { step(dt:number):void; hit():ProxyHit|null; interact(target:string,action:string):boolean; active(value:boolean):void; dispose():void } {
  const gestures=new Gestures(),doubleTap=new DoubleTap(),raycaster=new Raycaster(),ndc=new Vector2(),carryPoint=new Vector3(),tapPoint=new Vector3(),rate={yaw:0,pitch:0};
  const tapTarget=targets.find(item=>item.id==='tap');
  const pointers=new Map<number,{x:number;y:number;startX:number;startY:number}>(),progressEvent={progress:0};
  let hit:ProxyHit|null=null,enabled=false,x=innerWidth/2,y=innerHeight/2,lastTarget='',menuShown=false,pinch=0,latched=false,filling=false,lastProgress=-1,pendingFloorTap=false,tapReachable=false,touchMode=false,radialX=0,radialY=0;
  const reachable=():boolean=>!!hit&&(hit.target.kind==='floor'?Math.hypot(hit.point.x-player.x,hit.point.z-player.z)<=INTERACTION_REACH:withinReach(player,hit.target));
  const hideMenu=():void=>{bus.emit('hover',null);menuShown=false;};
  const updateHit=():void=>{ndc.set(x/canvas.clientWidth*2-1,-y/canvas.clientHeight*2+1);raycaster.setFromCamera(ndc,camera);hit=raycastProxies(raycaster.ray,targets,holding.id??'');};
  const showMenu=():void=>{
    if(!hit)return;if(!reachable()){bus.emit('notice',{text:'Move closer to reach this. Tap the floor to walk there, or double-tap a clear spot to jump.'});return;}
    const surface=hit.target.kind==='floor'||hit.target.id.startsWith('table-');
    const actions=holding.id?(surface?['Place']:hit.target.id==='tap'?['Fill']:[]):hit.target.actions;
    if(actions.length){bus.emit('hover',{target:hit.target.id,x,y,actions});menuShown=true;}
  };
  const release=():boolean=>{
    if(!holding.id)return false;const id=holding.id,surface=reachable()&&(hit?.target.kind==='floor'||hit?.target.id.startsWith('table-'));
    const dropX=surface?hit!.point.x:holding.origin.x,dropZ=surface?hit!.point.z:holding.origin.z,nearHome=Math.hypot(dropX-1.4,dropZ+.7)<.65;
    const valid=holding.release(surface?hit!.target.id:'invalid',nearHome?1.4:dropX,nearHome?-.7:dropZ,(surface?hit!.point.y:0)+.08);
    filling=false;latched=false;hideMenu();if(valid&&id==='water-bowl'&&water.returnToStation(holding.position.x,holding.position.z))bus.emit('chore:done',{id:'water'});return valid;
  };
  const cancel=():void=>{if(holding.id&&!latched)holding.release('invalid');pointers.clear();pinch=0;gestures.reset();doubleTap.reset();pendingFloorTap=false;radialX=radialY=0;lastTarget='';hideMenu();};
  const interact=(target:string,action:string):boolean=>{
    if(!enabled)return false;updateHit();const proxy=targets.find(item=>item.id===target);
    if(target==='floor'?hit?.target.id!=='floor'||!reachable():!proxy||!withinReach(player,proxy)){hideMenu();bus.emit('notice',{text:'Move closer to reach this.'});return false;}
    if(action==='Pick up'){if(!holding.start(target))return false;latched=true;filling=false;}
    if(action==='Place'){if(hit?.target.id!==target)return false;return release();}
    if(action==='Fill'&&target==='tap'&&holding.id==='water-bowl')filling=true;
    gestures.reset();hideMenu();return true;
  };
  const down=(e:PointerEvent):void=>{
    if(!enabled)return;e.preventDefault();touchMode=e.pointerType==='touch';canvas.setPointerCapture(e.pointerId);pointers.set(e.pointerId,{x:e.clientX,y:e.clientY,startX:e.clientX,startY:e.clientY});x=e.clientX;y=e.clientY;updateHit();lastTarget=hit?.target.id??'';pendingFloorTap=false;hideMenu();
    if(pointers.size===2){const values=[...pointers.values()];pinch=Math.hypot(values[0]!.x-values[1]!.x,values[0]!.y-values[1]!.y);}
    const kind=hit?.target.kind??'none';gestures.toggle=settings.holdToggle&&!holding.id;
    gestures.press(kind==='object'&&!reachable()?'none':kind,e.button===2,pointers.size);
    if(gestures.state==='look'){doubleTap.reset();return;}
    if(gestures.state==='hold'&&hit&&holding.start(hit.target.id)){latched=true;filling=false;}
  };
  const move=(e:PointerEvent):void=>{
    const previous=pointers.get(e.pointerId);const dx=e.clientX-(previous?.x??e.clientX),dy=e.clientY-(previous?.y??e.clientY);x=e.clientX;y=e.clientY;if(!enabled)return;updateHit();
    if(previous){previous.x=x;previous.y=y;const state=gestures.move(Math.hypot(x-previous.startX,y-previous.startY),pointers.size);
      if(state==='look'){player.look(dx/pointers.size,dy/pointers.size,touchMode);doubleTap.reset();hideMenu();}
      else if(state==='radial'){radialX=x-previous.startX;radialY=y-previous.startY;doubleTap.reset();hideMenu();}
      else if(state==='hold'&&!holding.id&&reachable()){holding.start(lastTarget);latched=settings.holdToggle;}
      if(pointers.size>1){const values=[...pointers.values()],a=values[0]!,b=values[1]!,next=Math.hypot(a.x-b.x,a.y-b.y);if(pinch)player.lean=Math.max(-.2,Math.min(.3,player.lean+(next-pinch)*.001));pinch=next;}
    }
  };
  const up=(e:PointerEvent):void=>{
    if(!enabled)return;const wasDown=gestures.down,state=gestures.state,moved=gestures.moved;pointers.delete(e.pointerId);pinch=0;radialX=radialY=0;gestures.release();
    if(pointers.size===0&&wasDown&&state!=='look'){
      if(state==='hold'&&holding.id&&!latched)release();
      else if(moved<=controls.dragThresholdPx){if(hit?.target.kind==='floor'){if(doubleTap.tap(x,y,e.timeStamp/1000)){hideMenu();/* Jump to the first tap's point: on a slow frame that tap may already have started a walk. */if(!player.jumpTo(tapPoint.x,tapPoint.z))bus.emit('notice',{text:`Choose a clear floor spot within ${controls.jumpMaxMeters} metres.`});}else{pendingFloorTap=true;tapReachable=reachable();tapPoint.copy(hit.point);}}else if(hit)showMenu();}
      else doubleTap.reset();
    }
    if(canvas.hasPointerCapture(e.pointerId))canvas.releasePointerCapture(e.pointerId);
  };
  const wheel=(e:WheelEvent):void=>{if(enabled){e.preventDefault();player.lean=Math.max(-.2,Math.min(.3,player.lean-e.deltaY*.0005));}};
  const context=(e:Event):void=>e.preventDefault();
  canvas.addEventListener('pointerdown',down);canvas.addEventListener('pointermove',move);canvas.addEventListener('pointerup',up);canvas.addEventListener('pointercancel',cancel);window.addEventListener('blur',cancel);canvas.addEventListener('wheel',wheel,{passive:false});canvas.addEventListener('contextmenu',context);
  return {hit:()=>hit,interact,active(value){enabled=value;cancel();},step(dt){
    if(!enabled)return;gestures.holdMs=settings.holdMs;doubleTap.step(dt);updateHit();
    // A single floor tap walks there; while carrying, a reachable floor tap offers Place instead.
    if(pendingFloorTap&&doubleTap.elapsed>controls.doubleTapSeconds){pendingFloorTap=false;if(holding.id&&tapReachable)showMenu();else if(!player.walkTo(tapPoint.x,tapPoint.z))bus.emit('notice',{text:'There is no clear path to that spot.'});}
    const target=reachable()?hit?.target.id??'':'';
    if(!gestures.down&&target!==lastTarget){gestures.reset();gestures.target=target?(hit?.target.kind??'none'):'none';lastTarget=target;hideMenu();}
    if(!touchMode||gestures.down)gestures.tick(dt);if(gestures.state==='menu'&&!menuShown)showMenu();
    // Holding a radial drag keeps turning, so one drag can turn a full circle or sweep the view up and down.
    if(gestures.down&&gestures.state==='radial'&&pointers.size===1){radialRate(radialX,radialY,touchMode,settings.reducedMotion,rate);player.turn(rate.yaw*dt,rate.pitch*dt);}
    if(holding.id){
      const under=filling&&!!tapTarget&&withinReach(player,tapTarget)&&holding.id==='water-bowl';
      if(under)holding.move(-2,controls.tapBowlHeightMeters,-3.68);else{filling=false;const side=settings.leftHanded?-controls.carrySideMeters:controls.carrySideMeters;carryPoint.set(side,controls.carryHeightMeters-1.6,-controls.carryForwardMeters).applyEuler(camera.rotation);holding.move(player.x+carryPoint.x,1.6+carryPoint.y,player.z+carryPoint.z);}
      const progress=water.step(dt,under);if(under&&progress!==lastProgress){progressEvent.progress=progress;lastProgress=progress;bus.emit('chore:progress',progressEvent);}
    }
  },dispose(){cancel();canvas.removeEventListener('pointerdown',down);canvas.removeEventListener('pointermove',move);canvas.removeEventListener('pointerup',up);canvas.removeEventListener('pointercancel',cancel);window.removeEventListener('blur',cancel);canvas.removeEventListener('wheel',wheel);canvas.removeEventListener('contextmenu',context);}};
}
