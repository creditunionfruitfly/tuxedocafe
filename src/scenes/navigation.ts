import { blocked, FURNITURE, ROOM } from './collision.ts';
export interface Waypoint { x: number; z: number }
const radius = .25, spacing = .4;
export function walkable(x: number, z: number): boolean {
  return x >= ROOM.minX + radius && x <= ROOM.maxX - radius && z >= ROOM.minZ + radius && z <= ROOM.maxZ - radius && !FURNITURE.some(box => blocked(x, z, box, radius));
}
function clear(a: Waypoint, b: Waypoint): boolean {
  const steps = Math.ceil(Math.hypot(b.x-a.x,b.z-a.z)/.08);
  for(let i=1;i<=steps;i++)if(!walkable(a.x+(b.x-a.x)*i/steps,a.z+(b.z-a.z)*i/steps))return false;
  return true;
}
/** Small deterministic room grid. Only destination changes allocate or search. */
export function route(start: Waypoint, end: Waypoint): Waypoint[] {
  if(!walkable(end.x,end.z))return [];
  if(clear(start,end))return [{...end}];
  const nodes: Waypoint[]=[], width=24, height=19;
  for(let z=0;z<height;z++)for(let x=0;x<width;x++)nodes.push({x:-4.6+x*spacing,z:-4.6+z*spacing});
  const nearest=(point:Waypoint):number=>{let best=-1,distance=Infinity;nodes.forEach((node,i)=>{const d=Math.hypot(node.x-point.x,node.z-point.z);if(d<distance&&walkable(node.x,node.z)&&clear(point,node)){distance=d;best=i;}});return best;};
  const first=nearest(start),last=nearest(end);if(first<0||last<0)return [];
  const parents=new Int16Array(nodes.length).fill(-1),queue=[first];parents[first]=first;
  for(let q=0;q<queue.length&&parents[last]===-1;q++){
    const current=queue[q]!;
    for(const next of [current-width,current+width,current%width?current-1:-1,current%width<width-1?current+1:-1]){
      if(next<0||next>=nodes.length||parents[next]!==-1||!walkable(nodes[next]!.x,nodes[next]!.z))continue;
      parents[next]=current;queue.push(next);
    }
  }
  if(parents[last]===-1)return [];
  const path=[{...end}];for(let i=last;i!==first;i=parents[i]!)path.unshift(nodes[i]!);path.unshift(nodes[first]!);
  const result:Waypoint[]=[];let previous=start;
  for(let i=0;i<path.length;i++){let next=i;while(next+1<path.length&&clear(previous,path[next+1]!))next++;previous=path[next]!;result.push(previous);i=next;}
  return result;
}
