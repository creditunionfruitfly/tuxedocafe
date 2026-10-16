import { BoxGeometry,Color,DirectionalLight,Mesh,MeshStandardMaterial,PerspectiveCamera,PlaneGeometry,Scene,Group,PMREMGenerator,Texture,type Object3D,type WebGLRenderer } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { assetUrl } from '../core/assets.ts';
import { loadCafeBake, useRoomProbe } from '../render/baked-lighting.ts';
export interface Cafe { scene: Scene; camera: PerspectiveCamera; load(): Promise<void>; object(id:string):Object3D|undefined; updateLighting(x:number,y:number,z:number):void; dispose():void }
export function createCafe(renderer: WebGLRenderer): Cafe {
  const scene=new Scene();const environment=new RoomEnvironment();const pmrem=new PMREMGenerator(renderer);const environmentMap=pmrem.fromScene(environment,.04);scene.environment=environmentMap.texture;scene.environmentIntensity=.7;environment.dispose();pmrem.dispose();scene.background=new Color('#d6e9e2');
  const camera=new PerspectiveCamera(61,1,.04,60);camera.position.set(0,1.6,2.2);camera.lookAt(0,1.25,-3);scene.add(camera);
  const fallback=new Group();scene.add(fallback);
  const floor=new Mesh(new PlaneGeometry(10,8),new MeshStandardMaterial({color:'#c69c74',roughness:.67}));floor.rotation.x=-Math.PI/2;floor.position.z=-1;fallback.add(floor);
  const wall=new Mesh(new BoxGeometry(10,3.5,.12),new MeshStandardMaterial({color:'#eceadf'}));wall.position.set(0,1.75,-5);fallback.add(wall);
  // This key matches the offline sun. Static diffuse already includes its shadows.
  const sun=new DirectionalLight(new Color(1,.91,.75),2.2);sun.position.set(-1,6,-8);sun.target.position.set(0,.7,-1);sun.castShadow=true;sun.shadow.mapSize.set(1024,1024);sun.shadow.camera.left=-6;sun.shadow.camera.right=6;sun.shadow.camera.top=6;sun.shadow.camera.bottom=-6;sun.shadow.normalBias=.03;scene.add(sun,sun.target);
  let lighting:Awaited<ReturnType<typeof loadCafeBake>>|undefined;
  const objects=new Map<string,Object3D>();const loader=new GLTFLoader();loader.setMeshoptDecoder(MeshoptDecoder);
  const disposeObject=(root:Object3D):void=>{
    const textures=new Set<Texture>();
    root.traverse(node=>{if(node instanceof Mesh){node.geometry.dispose();const materials=Array.isArray(node.material)?node.material:[node.material];for(const material of materials){for(const value of Object.values(material))if(value instanceof Texture)textures.add(value);material.dispose();}}});
    for(const texture of textures)texture.dispose();
  };
  return {scene,camera,object:id=>objects.get(id),updateLighting(x,y,z){lighting?.probe.update(x,y,z);},async load(){
    const gltf=await loader.loadAsync(assetUrl('art/env_cafe.glb'));scene.remove(fallback);disposeObject(fallback);scene.add(gltf.scene);
    gltf.scene.traverse(node=>{objects.set(node.name,node);if(node instanceof Mesh){node.receiveShadow=true;node.castShadow=true;}});
    lighting=await loadCafeBake(gltf.scene);scene.add(lighting.probe.light);useRoomProbe(gltf.scene);
  },dispose(){disposeObject(scene);lighting?.dispose();sun.dispose();environmentMap.dispose();}};
}
