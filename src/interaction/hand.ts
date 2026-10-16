import { Group, Mesh, MeshStandardMaterial, SphereGeometry, Vector3, type Object3D, type PerspectiveCamera } from 'three';
import type { ProxyHit } from './proxies.ts';
export function createHand(camera: PerspectiveCamera): { group: Group; update(hit: ProxyHit|null, holding: boolean): void; customize(skin: string,sleeve: string): void; setModel(model: Object3D): void; dispose(): void } {
  const group=new Group();camera.add(group);group.visible=false;
  const geometry=new SphereGeometry(.06,12,8), skinMaterial=new MeshStandardMaterial({color:'#c08b68'}), sleeveMaterial=new MeshStandardMaterial({color:'#659a8f'});
  const palm=new Mesh(geometry,skinMaterial);palm.scale.set(1,.4,1.35);group.add(palm);
  const point=new Vector3();let model:Object3D|null=null;
  return {group,update(hit,holding){group.visible=!!hit || holding;if(!hit)return;point.copy(hit.point).addScaledVector(hit.normal,.06);camera.worldToLocal(point);group.position.copy(point);group.scale.setScalar(.85);group.rotation.set(-.45,0,.2);},customize(skin,sleeve){skinMaterial.color.set(skin);sleeveMaterial.color.set(sleeve);model?.traverse(node=>{if(node instanceof Mesh){const materials=Array.isArray(node.material)?node.material:[node.material];for(const material of materials)if(material instanceof MeshStandardMaterial)material.color.set(material.name.toLowerCase().includes('sleeve')?sleeve:skin);}});},setModel(value){model=value;group.remove(palm);group.add(value);},dispose(){geometry.dispose();skinMaterial.dispose();sleeveMaterial.dispose();}};
}
