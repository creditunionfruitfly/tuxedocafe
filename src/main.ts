import buildInfo from 'virtual:build-info';
import './ui/styles.css';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { Vector3 } from 'three';
import { formatStamp } from './core/build-info.ts';
import { assetUrl } from './core/assets.ts';
import { FixedLoop } from './core/loop.ts';
import { EventBus } from './core/events.ts';
import { parseFlags } from './core/flags.ts';
import { watchUpdates } from './core/update-check.ts';
import { SaveStore,browserStorage } from './core/storage.ts';
import { TierBenchmark,chooseTier,parseTier,probeDevice } from './core/tiers.ts';
import { createRenderer } from './render/renderer.ts';
import { mountLookdev } from './scenes/lookdev.ts';
import { createCafe } from './scenes/cafe.ts';
import { Player } from './scenes/player.ts';
import { installOrientation } from './input/orientation.ts';
import { installKeys } from './input/keys.ts';
import { installPointer } from './input/pointer.ts';
import { makeProxy } from './interaction/proxies.ts';
import { HoldDrag } from './interaction/hold-drag.ts';
import { TapFill } from './interaction/tap-fill.ts';
import { createHand } from './interaction/hand.ts';
import { mountAbout } from './ui/about.ts';
import { mountShell } from './ui/shell.ts';
import { mountHoverMenu } from './ui/hover-menu.ts';
import { freshVisit,cleanVisit } from './save/visit.ts';
async function boot():Promise<void>{
const body=document.body,bus=new EventBus();
const stamp=document.querySelector<HTMLElement>('#build-stamp');if(stamp)stamp.textContent=formatStamp(buildInfo);
body.dataset.flags=[...parseFlags(buildInfo.flags,location.search)].join(',');
const store=new SaveStore(buildInfo.channel,browserStorage(),freshVisit,{},text=>bus.emit('notice',{text}));
await store.open();const visit=cleanVisit(await store.load('visit'));const save=():Promise<void>=>store.save('visit',visit);
watchUpdates(buildInfo,save,reload=>{const button=document.querySelector<HTMLButtonElement>('#update');if(button){button.hidden=false;button.onclick=reload;}});
let rendererReady=false;
try {
  const canvas=document.querySelector<HTMLCanvasElement>('#view')!,display=createRenderer(canvas),cafe=createCafe(display.renderer),{scene,camera}=cafe;
  rendererReady=true;const player=new Player(),holding=new HoldDrag(),water=new TapFill();water.completed=visit.waterDone;
  const targets=[makeProxy('water-bowl',[1.4,.13,-.7],[.5,.26,.5],['Pick up','Fill']),makeProxy('food-bowl',[1.9,.13,-.7],[.45,.26,.45],['Pick up','Fill']),makeProxy('tap',[-2,1.2,-3.55],[.9,.65,.75],['Fill']),makeProxy('litter-1',[4.25,.2,-3.6],[.8,.4,.55],['Clean']),makeProxy('litter-2',[4.25,.2,-4.3],[.8,.4,.55],['Clean']),makeProxy('scoop',[4.65,.4,-3.9],[.35,.25,.5],['Pick up']),makeProxy('table-1',[-2,.75,-.6],[1.3,.12,1.3],['Place']),makeProxy('table-2',[.5,.75,-3.1],[1.3,.12,1.3],['Place'])];
  const targetMap=new Map(targets.map(target=>[target.id,target]));
  const menu=mountHoverMenu(bus),keyboard=installKeys(index=>menu.select(index));
  const pointer=installPointer(canvas,camera,player,targets,bus,holding,water,visit.settings),hand=createHand(camera);
  let playing=false,paused=false,benchmarkDone=false,contextReloadPending=false,previous=0,drawFrames=0,frameSum=0,tierPreference=visit.settings.tier;
  const probe=probeDevice(display.renderer.getContext() as WebGL2RenderingContext),benchmark=new TierBenchmark();
  const override=parseTier(new URLSearchParams(location.search).get('tier'));if(override){benchmarkDone=display.configure(override);contextReloadPending=!benchmarkDone;}
  const forwardVector=new Vector3();
  const loop=new FixedLoop(dt=>{
    if(!playing)return;
    const k=keyboard.keys;player.step(dt,(Number(k.has('d')||k.has('arrowright'))-Number(k.has('a')||k.has('arrowleft'))),(Number(k.has('w')||k.has('arrowup'))-Number(k.has('s')||k.has('arrowdown'))));
    pointer.step(dt);hand.step(dt);bus.emit('player',{x:player.x,z:player.z});body.dataset.player=`${player.x.toFixed(2)},${player.z.toFixed(2)}`;
    body.dataset.carry=holding.id??'';body.dataset.look=`${player.yaw.toFixed(3)},${player.pitch.toFixed(3)},${player.lean.toFixed(3)}`;
    for(const [id,placed] of holding.placements){
      const p=holding.id===id?holding.position:placed,model=cafe.object(id),proxy=targetMap.get(id);
      if(proxy){proxy.box.min.set(p.x-.25,p.y-.08,p.z-.25);proxy.box.max.set(p.x+.25,p.y+.18,p.z+.25);}
      if(model){model.position.x+=(p.x-model.position.x)*.35;model.position.y+=(p.y-.08-model.position.y)*.35;model.position.z+=(p.z-model.position.z)*.35;}
    }
  },alpha=>{
    camera.position.set(player.previousX+(player.x-player.previousX)*alpha,1.6,player.previousZ+(player.z-player.previousZ)*alpha);camera.rotation.set(player.pitch,player.yaw,0,'YXZ');
    forwardVector.set(0,0,-player.lean).applyQuaternion(camera.quaternion);camera.position.add(forwardVector);camera.aspect=canvas.clientWidth/Math.max(canvas.clientHeight,1);camera.updateProjectionMatrix();camera.updateMatrixWorld();
    hand.update(playing?pointer.hit():null,!!holding.id);display.renderer.render(scene,camera);
    if(benchmarkDone&&!contextReloadPending&&body.dataset.ready!=='true'){const start=document.querySelector<HTMLButtonElement>('#start')!;start.disabled=false;start.setAttribute('aria-busy','false');body.dataset.ready='true';}body.dataset.drawCalls=String(display.renderer.info.render.calls);body.dataset.triangles=String(display.renderer.info.render.triangles);body.dataset.shaderPrograms=String(display.renderer.info.programs?.length??0);
    if(++drawFrames%60===0){body.dataset.frameMs=(frameSum/60).toFixed(1);frameSum=0;}
  });
  bus.on('session',value=>{playing=value.playing;pointer.active(playing&&!paused);keyboard.keys.clear();});
  bus.on('settings',value=>{if(value.tier!==tierPreference){tierPreference=value.tier;const url=new URL(location.href);if(value.tier==='auto')url.searchParams.delete('tier');else url.searchParams.set('tier',value.tier);void save().then(()=>location.assign(url.href));}player.reducedMotion=value.reducedMotion;const tier=parseTier(value.tier)??override;if(tier){benchmarkDone=display.configure(tier);contextReloadPending=!benchmarkDone;}else benchmarkDone=false;});
  bus.on('profile',profile=>hand.customize(profile.skin,profile.sleeve));
  bus.on('action',({target,action})=>{
    body.dataset.lastAction=`${target}:${action}`;
    if(action==='Pick up' && holding.start(target)){bus.emit('hover',null);bus.emit('notice',{text:'Bowl in hand. Move it to the tap, then place it back on the floor.'});}
    else if(action==='Fill')bus.emit('notice',{text:target==='water-bowl'?'Pick up the blue bowl and carry it to the tap.':'The water tap is ready. Bring the blue bowl here.'});
    else if(action==='Clean')bus.emit('notice',{text:'This station is tidy. Staff keep every cat comfortable.'});else bus.emit('notice',{text:'A lovely spot for a quiet cup.'});
  });
  installOrientation(value=>{paused=value;loop.paused=value;loop.reset();pointer.active(playing&&!paused);});
  mountShell(bus,visit,save);mountAbout(buildInfo);
  await cafe.load();const handLoader=new GLTFLoader();handLoader.setMeshoptDecoder(MeshoptDecoder);const gltf=await handLoader.loadAsync(assetUrl('art/hand.glb'));hand.setModel(gltf.scene,gltf.animations);if(visit.profile)hand.customize(visit.profile.skin,visit.profile.sleeve);
  // The first render skips the hidden hand. Compile every scene material before
  // input starts so the first reach cannot stall hover dwell or a floor tap.
  await display.renderer.compileAsync(scene,camera);
  display.renderer.setAnimationLoop(time=>{
    if(!benchmarkDone&&!contextReloadPending){const result=benchmark.update(time);if(result!==null){benchmarkDone=display.configure(chooseTier(probe,result));contextReloadPending=!benchmarkDone;body.dataset.benchmarkMs=result.toFixed(1);}}
    const elapsed=previous?time-previous:16.7;frameSum+=elapsed;if(previous)display.adapt(elapsed);previous=time;loop.frame(time);
  });
  window.addEventListener('pagehide',()=>{void save();});
} catch(error) {
  document.querySelector<HTMLElement>('#unsupported')?.removeAttribute('hidden');body.dataset.ready='unsupported';console.warn('Café loading failed',error);if(rendererReady)window.dispatchEvent(new Event('cafe:asset-error'));
}

}
const lookdev=new URLSearchParams(location.search).get('lookdev');
if(lookdev)await mountLookdev(lookdev);else await boot();
