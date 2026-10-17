import { Box3,Color,DirectionalLight,HemisphereLight,Mesh,MeshStandardMaterial,PerspectiveCamera,PlaneGeometry,Scene,Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { assetUrl,siteUrl } from '../core/assets.ts';
import { parseTier } from '../core/tiers.ts';
import { createRenderer } from '../render/renderer.ts';
import { createCafe } from './cafe.ts';
import { installOrientation } from '../input/orientation.ts';
const ASSETS={cat:'art/cats/cat_placeholder_lod0.glb',hand:'art/hand.glb',cafe:'art/env_cafe.glb'} as const;
/** Explicit public asset whitelist: diagnostic URLs never become arbitrary fetches. */
export function lookdevAsset(value:string):keyof typeof ASSETS|null{return value==='cat'||value==='hand'||value==='cafe'?value:null;}
export async function mountLookdev(value:string):Promise<void>{
 const asset=lookdevAsset(value);if(!asset)throw new Error('Use ?lookdev=cat, hand or cafe.');
 if(asset==='cat'){await (await import('./cat-lookdev.ts')).mountCatLookdev();return;}
 document.querySelector('#title-screen')?.setAttribute('hidden','');document.querySelector('.top-settings')?.setAttribute('hidden','');document.body.dataset.phase='lookdev';
 const display=createRenderer(document.querySelector<HTMLCanvasElement>('#view')!);display.configure(parseTier(new URLSearchParams(location.search).get('tier'))??'desktop');
 let scene:Scene,camera:PerspectiveCamera,bones=0;
 if(asset==='cafe'){const cafe=createCafe(display.renderer);await cafe.load();scene=cafe.scene;camera=cafe.camera;}
 else{
  scene=new Scene();scene.background=new Color('#d7e5df');camera=new PerspectiveCamera(45,1,.01,30);
  scene.add(new HemisphereLight(0xffffff,0x8c7d6a,1.8));const key=new DirectionalLight(0xffefda,2.3);key.position.set(2,4,3);scene.add(key);
  const floor=new Mesh(new PlaneGeometry(6,6),new MeshStandardMaterial({color:'#bacdc1',roughness:.9}));floor.rotation.x=-Math.PI/2;floor.position.y=-.015;scene.add(floor);
  const loader=new GLTFLoader();loader.setMeshoptDecoder(MeshoptDecoder);const gltf=await loader.loadAsync(assetUrl(ASSETS[asset]));scene.add(gltf.scene);gltf.scene.traverse(node=>{if(node.type==='Bone')bones++;});
  const bounds=new Box3().setFromObject(gltf.scene),center=bounds.getCenter(new Vector3()),size=bounds.getSize(new Vector3()),distance=Math.max(size.x,size.y,size.z)*1.9;
  camera.position.copy(center).add(new Vector3(distance*.8,distance*.45,distance));camera.lookAt(center);const controls=new OrbitControls(camera,display.renderer.domElement);controls.target.copy(center);controls.minDistance=distance*.45;controls.maxDistance=distance*4;controls.update();
 }
 const label=document.createElement('aside');label.id='lookdev-status';label.className='glass hud-card';label.style.top='100px';label.textContent=`${asset==='hand'?'Wrist-rigged hand':'Café environment'} · ${document.body.dataset.tier} · drag to inspect`;
 const links=document.createElement('p');for(const name of Object.keys(ASSETS)){const link=document.createElement('a');link.href=siteUrl(`?lookdev=${name}&tier=${document.body.dataset.tier}`);link.textContent=`${name}  `;links.append(link);}label.append(links);document.body.append(label);document.body.dataset.bones=String(bones);
 installOrientation(()=>{});display.renderer.setAnimationLoop(()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();display.renderer.render(scene,camera);document.body.dataset.ready='true';document.body.dataset.drawCalls=String(display.renderer.info.render.calls);document.body.dataset.triangles=String(display.renderer.info.render.triangles);});
}
