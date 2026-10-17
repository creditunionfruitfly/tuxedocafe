/** Contract the recessed socket lining under the analytic lid margin, without changing UVs. */
import { type Anatomy, eyeAngles } from './anatomy.ts';
import { add, scale, smoothstep } from './sdf.ts';

export function refineLids(P:Float64Array,cat:Anatomy){
 for(let v=0;v<P.length/3;v++)for(const e of cat.eyes){
  const a=eyeAngles(e,P[v*3]!,P[v*3+1]!,P[v*3+2]!);
  const support=1-smoothstep(e.radius+e.gap+.0001,e.radius+e.gap+.0015,a.r);
  if(support<=0||a.front<=0||a.h<e.inner-.65||a.h>e.outer+.65)continue;
  const mid=(e.inner+e.outer)/2,half=(e.outer-e.inner)/2,phi=Math.atan2((a.v-.015)/.50,(a.h-mid)/half),h=mid+half*Math.cos(phi),t=(h-e.inner)/(e.outer-e.inner),vertical=Math.sin(phi)>=0?e.upper(t):e.lower(t);
  // Retain a small undercut, so the lining keeps thickness and no triangles collapse.
  const hh=a.h+(h-a.h)*support*.92,vv=a.v+(vertical-a.v)*support*.92,cv=Math.cos(vv);
  const dir=add(add(scale(e.axis,Math.cos(hh)*cv),scale(e.lateral,Math.sin(hh)*cv)),scale(e.up,Math.sin(vv)));
  P.set(add(e.center,scale(dir,a.r)),v*3);
 }
}
