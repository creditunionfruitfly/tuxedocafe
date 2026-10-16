import { BoxGeometry,Color,DirectionalLight,HemisphereLight,Mesh,MeshStandardMaterial,PerspectiveCamera,PlaneGeometry,Scene,Group,Vector3,type Object3D } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { assetUrl } from '../core/assets.ts';
export interface Cafe { scene: Scene; camera: PerspectiveCamera; load(): Promise<void>; object(id:string):Object3D|undefined; dispose():void }
export function createCafe(): Cafe {
  const scene=new Scene();scene.background=new Color('#d6e9e2');
  const camera=new PerspectiveCamera(61,1,.04,60);camera.position.set(0,1.6,2.2);camera.lookAt(0,1.25,-3);scene.add(camera);
  const fallback=new Group();scene.add(fallback);
  const floor=new Mesh(new PlaneGeometry(10,8),new MeshStandardMaterial({color:'#c69c74',roughness:.67}));floor.rotation.x=-Math.PI/2;floor.position.z=-1;fallback.add(floor);
  const wall=new Mesh(new BoxGeometry(10,3.5,.12),new MeshStandardMaterial({color:'#eceadf'}));wall.position.set(0,1.75,-5);fallback.add(wall);
  scene.add(new HemisphereLight(0xf4fcff,0xc8a88b,2.4));
  const sun=new DirectionalLight(0xfff3d9,2.6);sun.position.set(-1,6,1);sun.castShadow=true;sun.shadow.mapSize.set(1024,1024);sun.shadow.camera.left=-6;sun.shadow.camera.right=6;sun.shadow.camera.top=6;sun.shadow.camera.bottom=-6;sun.shadow.normalBias=.03;scene.add(sun);
  const fill=new DirectionalLight(0xc4ebed,.6);fill.position.set(4,3,-2);scene.add(fill);
  const objects=new Map<string,Object3D>();const loader=new GLTFLoader();loader.setMeshoptDecoder(MeshoptDecoder);
  const disposeObject=(root:Object3D):void=>root.traverse(node=>{if(node instanceof Mesh){node.geometry.dispose();const materials=Array.isArray(node.material)?node.material:[node.material];for(const material of materials)material.dispose();}});
  return {scene,camera,object:id=>objects.get(id),async load(){
    const gltf=await loader.loadAsync(assetUrl('art/env_cafe.glb'));scene.remove(fallback);disposeObject(fallback);scene.add(gltf.scene);
    gltf.scene.traverse(node=>{objects.set(node.name,node);if(node instanceof Mesh){node.receiveShadow=true;node.castShadow=true;}});
    // Broad daylight, with the window's glass carrying a restrained sunlit sheen.
    const target=new Vector3(0,1,-2);sun.target.position.copy(target);scene.add(sun.target);
  },dispose(){disposeObject(scene);}};
}
