import { Box3, Plane, Ray, Vector3 } from 'three';
import controls from '../../data/interaction.json' with { type: 'json' };
export interface ProxyTarget { id: string; region: string; kind: 'object' | 'floor' | 'cat'; box: Box3; actions: readonly string[] }
export interface ProxyHit { target: ProxyTarget; region: string; point: Vector3; normal: Vector3 }
export const INTERACTION_REACH=controls.reachMeters;
/** Horizontal reach lets a standing patron reach bowls on the floor. */
export function withinReach(position:{x:number;z:number},target:ProxyTarget):boolean {
  const x=Math.max(target.box.min.x,Math.min(target.box.max.x,position.x)),z=Math.max(target.box.min.z,Math.min(target.box.max.z,position.z));
  return Math.hypot(x-position.x,z-position.z)<=INTERACTION_REACH;
}
const point = new Vector3(); const floor = new Plane(new Vector3(0,1,0), 0);
export function makeProxy(id: string, position: readonly number[], size: readonly number[], actions: readonly string[]): ProxyTarget {
  const x=position[0]!, y=position[1]!, z=position[2]!, w=size[0]!/2, h=size[1]!/2, d=size[2]!/2;
  return { id, region: id, kind: 'object', box: new Box3(new Vector3(x-w,y-h,z-d),new Vector3(x+w,y+h,z+d)), actions };
}
const floorTarget: ProxyTarget = { id:'floor', region:'floor', kind:'floor', box:new Box3(), actions:[] };
const defaultHit: ProxyHit={target:floorTarget,region:'floor',point:new Vector3(),normal:new Vector3(0,1,0)};
/** Only analytic boxes/plane participate. Render mesh complexity never affects input. */
export function raycastProxies(ray: Ray, targets: readonly ProxyTarget[], excluded = '', result: ProxyHit = defaultHit): ProxyHit | null {
  let distance = Infinity; let target: ProxyTarget | null=null; const hitPoint = result.point;
  for(const candidate of targets) {
    if(candidate.id===excluded || !ray.intersectBox(candidate.box,point))continue;
    const d=point.distanceToSquared(ray.origin); if(d<distance) { distance=d;target=candidate;hitPoint.copy(point); }
  }
  if(ray.intersectPlane(floor,point) && point.x>=-5 && point.x<=5 && point.z>=-5 && point.z<=3 && point.distanceToSquared(ray.origin)<distance) { target=floorTarget;hitPoint.copy(point); }
  // Objects answer within 7 m; the floor answers across the room so a tap can walk anywhere in view.
  if(!target || hitPoint.distanceToSquared(ray.origin)>(target===floorTarget?controls.floorTapMaxMeters**2:49))return null;
  const normal=result.normal;normal.set(0,1,0);
  if(target.kind==='object') {
    const b=target.box; const p=hitPoint; const e=.002;
    if(Math.abs(p.x-b.min.x)<e)normal.set(-1,0,0); else if(Math.abs(p.x-b.max.x)<e)normal.set(1,0,0); else if(Math.abs(p.z-b.min.z)<e)normal.set(0,0,-1);else if(Math.abs(p.z-b.max.z)<e)normal.set(0,0,1);
  }
  result.target=target;result.region=target.region;return result;
}
