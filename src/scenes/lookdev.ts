import { AnimationMixer,Box3,Color,DirectionalLight,HemisphereLight,Mesh,MeshStandardMaterial,PerspectiveCamera,PlaneGeometry,Scene,Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { applyResidentBuild, residentLod } from '../cats/resident.ts';
import { applyResidentTextures, loadResidentTextures } from '../cats/surfaces.ts';
import { assetUrl,siteUrl } from '../core/assets.ts';
import { parseTier } from '../core/tiers.ts';
import { createRenderer } from '../render/renderer.ts';
import { createCafe } from './cafe.ts';
import { installOrientation } from '../input/orientation.ts';
const ASSETS={cat:'art/cats/cat_placeholder_lod0.glb',hand:'art/hand.glb',cafe:'art/env_cafe.glb'} as const;
const RESIDENTS={biscuit:'Biscuit',juniper:'Juniper',pixel:'Pixel'} as const;
/** Explicit public asset whitelist: diagnostic URLs never become arbitrary fetches. */
export function lookdevAsset(value:string):keyof typeof ASSETS|null{return value==='cat'||value==='hand'||value==='cafe'?value:null;}
export async function mountLookdev(value:string):Promise<void>{
 const asset=lookdevAsset(value);if(!asset)throw new Error('Use ?lookdev=cat, hand or cafe.');
 document.querySelector('#title-screen')?.setAttribute('hidden','');document.querySelector('.top-settings')?.setAttribute('hidden','');document.body.dataset.phase='lookdev';
 const params=new URLSearchParams(location.search),tier=parseTier(params.get('tier'))??'desktop';
 const id=params.get('cat');
 const resident=asset==='cat'&&(id==='biscuit'||id==='juniper'||id==='pixel')?id:null;
 const studio=resident==='biscuit'||resident==='pixel';
 const display=createRenderer(document.querySelector<HTMLCanvasElement>('#view')!);display.configure(tier);
 let scene:Scene,camera:PerspectiveCamera,bones=0,orbit:OrbitControls|undefined;
 if(asset==='cafe'){const cafe=createCafe(display.renderer);await cafe.load();scene=cafe.scene;camera=cafe.camera;}
 else{
  scene=new Scene();scene.background=new Color('#d7e5df');camera=new PerspectiveCamera(45,1,.01,30);
  scene.add(new HemisphereLight(0xffffff,0x8c7d6a,1.8));const key=new DirectionalLight(0xffefda,2.3);key.position.set(2,4,3);scene.add(key);
  const floor=new Mesh(new PlaneGeometry(6,6),new MeshStandardMaterial({color:'#bacdc1',roughness:.9}));floor.rotation.x=-Math.PI/2;floor.position.y=-.015;scene.add(floor);
  if(studio){
   const rim=new DirectionalLight(0xe9edff,1.35);
   rim.position.set(-3,2,-3);scene.add(rim);
   key.position.set(1.6,3,2.7);key.color.set('#fff7ef');
   key.castShadow=true;key.shadow.mapSize.set(1024,1024);
   Object.assign(key.shadow.camera,{left:-.6,right:.6,top:.6,bottom:-.6,near:.1,far:6});
   key.shadow.normalBias=.003;
   floor.receiveShadow=true;
   if(resident==='biscuit'){
    key.intensity=1.9;
    key.color.set('#fff9f3');
    rim.intensity=1.05;
   }
  }
  const loader=new GLTFLoader();loader.setMeshoptDecoder(MeshoptDecoder);
  const walkPose=studio&&params.get('pose')==='walk';
  const [gltf,[textures],clips]=await Promise.all([
   loader.loadAsync(assetUrl(resident?`art/cats/cat_master_${residentLod(tier)}.glb`:ASSETS[asset])),
   resident?loadResidentTextures([resident],tier,display.renderer):[],
   walkPose?loader.loadAsync(assetUrl('art/cats/cat_anims.glb')):undefined,
  ]);
  if(studio)applyResidentBuild(gltf.scene,resident);
  const walk=clips?.animations.find(clip=>clip.name==='cat.loco.walk');
  if(walk){
   const mixer=new AnimationMixer(gltf.scene);
   mixer.clipAction(walk).play();
   mixer.setTime(walk.duration*.34);
  }
  scene.add(gltf.scene);
  gltf.scene.traverse(node=>{
   if(node.type==='Bone')bones++;
   if(resident&&textures&&node instanceof Mesh&&node.material instanceof MeshStandardMaterial){
    node.frustumCulled=false;
    node.castShadow=studio&&!node.material.transparent;
    node.material=node.material.clone();
    applyResidentTextures(node,node.material,textures,resident);
   }
  });
  const bounds=new Box3().setFromObject(gltf.scene),center=bounds.getCenter(new Vector3()),size=bounds.getSize(new Vector3());
  let distance=Math.max(size.x,size.y,size.z)*1.9;
  const eyeL=gltf.scene.getObjectByName('eye_L'),eyeR=gltf.scene.getObjectByName('eye_R');
  const view=params.get('view');
  if(resident&&view==='face'&&eyeL&&eyeR){
   eyeL.getWorldPosition(center).lerp(eyeR.getWorldPosition(new Vector3()),.5);
   distance=.18;
   const offset=resident==='biscuit'?new Vector3(.038,.018,distance):new Vector3(0,.012,distance);
   camera.position.copy(center).add(offset);
  }else if(resident==='biscuit'&&view==='shoulders'){
   center.set(0,.23,-.032);
   distance*=.74;
   camera.position.copy(center).add(new Vector3(distance*.12,distance,distance*.22));
  }else if(resident==='biscuit'){
   distance*=.66;
   camera.position.copy(center).add(new Vector3(distance,distance*.26,distance*.45));
  }else if(resident==='pixel'){
   distance*=.65;
   camera.position.copy(center).add(new Vector3(distance,distance*.24,distance*.55));
  }else camera.position.copy(center).add(new Vector3(distance*.8,distance*.45,distance));
  camera.lookAt(center);orbit=new OrbitControls(camera,display.renderer.domElement);orbit.target.copy(center);orbit.minDistance=distance*.45;orbit.maxDistance=distance*4;orbit.update();
 }
 const subject=resident?RESIDENTS[resident]:asset==='cat'?'65-bone capsule rig diagnostic':asset==='hand'?'Wrist-rigged hand':'Café environment';
 const label=document.createElement('aside');label.id='lookdev-status';label.className='glass hud-card';label.style.top='100px';label.textContent=`${subject} · ${document.body.dataset.tier} · drag to inspect`;
 const links=document.createElement('p');for(const name of Object.keys(ASSETS)){const link=document.createElement('a');link.href=siteUrl(`?lookdev=${name}&tier=${document.body.dataset.tier}`);link.textContent=`${name}  `;links.append(link);}label.append(links);document.body.append(label);document.body.dataset.bones=String(bones);
 installOrientation(()=>{});
 let framePending=false;
 const redraw=():void=>{
  if(framePending)return;
  framePending=true;
  requestAnimationFrame(()=>{
   framePending=false;
   camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();
   display.render(scene,camera,orbit?.getDistance());
   document.body.dataset.ready='true';
   document.body.dataset.drawCalls=String(display.renderer.info.render.calls);
   document.body.dataset.triangles=String(display.renderer.info.render.triangles);
  });
 };
 window.addEventListener('resize',redraw);
 orbit?.addEventListener('change',redraw);
 display.renderer.domElement.addEventListener('webglcontextrestored',redraw);
 redraw();
}
