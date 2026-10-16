import { Box3, Plane, Ray, Vector3 } from 'three';
export interface ProxyTarget { id: string; region: string; kind: 'object' | 'floor' | 'cat'; box: Box3; actions: readonly string[] }
export interface ProxyHit { target: ProxyTarget; region: string; point: Vector3; normal: Vector3 }
const point = new Vector3(); const floor = new Plane(new Vector3(0,1,0), 0);
export function makeProxy(id: string, position: readonly number[], size: readonly number[], actions: readonly string[]): ProxyTarget {
  const x=position[0]!, y=position[1]!, z=position[2]!, w=size[0]!/2, h=size[1]!/2, d=size[2]!/2;
  return { id, region: id, kind: 'object', box: new Box3(new Vector3(x-w,y-h,z-d),new Vector3(x+w,y+h,z+d)), actions };
}
const floorTarget: ProxyTarget = { id:'floor', region:'floor', kind:'floor', box:new Box3(), actions:[] };
/** Only analytic boxes/plane participate. Render mesh complexity never affects input. */
export function raycastProxies(ray: Ray, targets: readonly ProxyTarget[], excluded = ''): ProxyHit | null {
  let distance = Infinity; let target: ProxyTarget | null=null; const hitPoint = new Vector3();
  for(const candidate of targets) {
    if(candidate.id===excluded || !ray.intersectBox(candidate.box,point))continue;
    const d=point.distanceToSquared(ray.origin); if(d<distance) { distance=d;target=candidate;hitPoint.copy(point); }
  }
  if(ray.intersectPlane(floor,point) && point.x>=-5 && point.x<=5 && point.z>=-5 && point.z<=3 && point.distanceToSquared(ray.origin)<distance) { target=floorTarget;hitPoint.copy(point); }
  if(!target || hitPoint.distanceToSquared(ray.origin)>49)return null;
  const normal=new Vector3(0,1,0);
  if(target.kind==='object') {
    const b=target.box; const p=hitPoint; const e=.002;
    if(Math.abs(p.x-b.min.x)<e)normal.set(-1,0,0); else if(Math.abs(p.x-b.max.x)<e)normal.set(1,0,0); else if(Math.abs(p.z-b.min.z)<e)normal.set(0,0,-1);else if(Math.abs(p.z-b.max.z)<e)normal.set(0,0,1);
  }
  return { target, region:target.region, point:hitPoint, normal };
}
