/** Separate anatomical eye globes/cornea, dental surfaces, tongue, sheathed claws and tapered vibrissae. */
import { SphereGeometry } from 'three';
import { type Anatomy, type EyeFrame } from './anatomy.ts';
import { type Rig, joint } from './skeleton.ts';
import { type Vec3, add, scale, sub, normalize, cross } from './sdf.ts';
export interface Detail {name:string;material:string;positions:Float64Array;indices:Uint32Array;uv:Float32Array;bone:string;lowerMouth?:boolean;}
function eyeMesh(e:EyeFrame,lod:number,cornea:boolean):Detail {
 const ring=[32,20,12][lod]!, rows=cornea?[7,5,3][lod]!: [20,12,8][lod]!,P:number[]=[],UV:number[]=[],I:number[]=[];
 for(let j=0;j<=rows;j++) {const theta=(cornea?1.0:Math.PI)*j/rows,uvr=theta<=1.0?theta*.42:.42+(theta-1.0)/(Math.PI-1.0)*.08;
  for(let i=0;i<=ring;i++){const a=i/ring*Math.PI*2, d=add(scale(e.axis,Math.cos(theta)),add(scale(e.lateral,Math.sin(theta)*Math.cos(a)),scale(e.up,Math.sin(theta)*Math.sin(a))));const r=e.radius+(cornea?.00028+.00065*Math.cos(theta*Math.PI/2)**2:0);P.push(...add(e.center,scale(d,r)));UV.push(.5+Math.cos(a)*uvr,.5+Math.sin(a)*uvr);}}
 for(let j=0;j<rows;j++)for(let i=0;i<ring;i++){const a=j*(ring+1)+i,b=a+1,c=a+ring+1,d=c+1;if(j>0)I.push(a,b,c);if(cornea||j<rows-1)I.push(b,d,c);}
 // L's polar frame is right-handed looking toward the optical axis; R reverses it.
 if(e.side>0)for(let i=0;i<I.length;i+=3)[I[i+1],I[i+2]]=[I[i+2]!,I[i+1]!];
 const side=e.side>0?'L':'R';return {name:`cat_${cornea?'cornea':'eye'}_${side}`,material:cornea?'cat_cornea':'cat_eye',positions:Float64Array.from(P),indices:Uint32Array.from(I),uv:Float32Array.from(UV),bone:`eye_${side}`};
}
function ellipsoid(name:string,material:string,c:Vec3,r:Vec3,bone:string,lod:number,lowerMouth=false):Detail{const g=new SphereGeometry(1,[16,12,8][lod]!,[10,8,5][lod]!);const a=g.getAttribute('position'),P=new Float64Array(a.count*3);for(let i=0;i<a.count;i++)P.set([c[0]+a.getX(i)*r[0],c[1]+a.getY(i)*r[1],c[2]+a.getZ(i)*r[2]],i*3);return {name,material,positions:P,indices:Uint32Array.from(g.index!.array),uv:Float32Array.from(g.getAttribute('uv').array),bone,lowerMouth};}
function tube(name:string,material:string,pts:Vec3[],radius:number,sides:number,bone:string,lowerMouth=false):Detail{const P:number[]=[],UV:number[]=[],I:number[]=[];pts.forEach((p,j)=>{const dir=normalize(sub(pts[Math.min(j+1,pts.length-1)]!,pts[Math.max(0,j-1)]!)),r=radius*(1-j/(pts.length-1)*.97),a=normalize(cross(dir,Math.abs(dir[1])<.9?[0,1,0]:[1,0,0])),b=cross(dir,a);for(let i=0;i<sides;i++){const th=i/sides*Math.PI*2;P.push(...add(p,add(scale(a,r*Math.cos(th)),scale(b,r*Math.sin(th)))));UV.push(i/sides,j/(pts.length-1));}});for(let j=0;j<pts.length-1;j++)for(let i=0;i<sides;i++){const a=j*sides+i,b=j*sides+(i+1)%sides,c=a+sides,d=b+sides;I.push(a,b,c,b,d,c);}return {name,material,positions:Float64Array.from(P),indices:Uint32Array.from(I),uv:Float32Array.from(UV),bone,lowerMouth};}
export function details(cat:Anatomy,rig:Rig,lod:number):Detail[]{const out:Detail[]=[];for(const e of cat.eyes){out.push(eyeMesh(e,lod,false));out.push(eyeMesh(e,lod,true));}
 const H=joint(rig,'head'),mouthY=H[1]-.016;
 out.push(ellipsoid('cat_tongue','cat_mouth',[0,mouthY-.004,H[2]+.045],[.007,.002,.014],'jaw',lod,true));
 for(const lower of [false,true]){const dy=lower?-.009:.008,bone=lower?'jaw':'head',depth=lower?-.012:0;const gum:Vec3[]=[];for(let i=0;i<=10;i++){const t=i/10*Math.PI;gum.push([Math.cos(t)*.008,mouthY+dy,H[2]+.049+depth+Math.sin(t)*.010]);}out.push(tube(`cat_${lower?'lower':'upper'}_gum`,'cat_mouth',gum,.0011,lod===0?6:4,bone,lower));for(const side of [-1,1]){const c:Vec3=[side*.0078,mouthY+dy,H[2]+.053+depth],sign=lower?1:-1;out.push(tube(`cat_${lower?'lower':'upper'}_canine_${side}`,'cat_teeth',[c,add(c,[side*.0004,sign*.002,-.0001]),add(c,[0,sign*.0045,.001])],.00145,[8,6,4][lod]!,bone,lower));}
 if(lod<2)for(let i=0;i<6;i++){const c:Vec3=[(i-2.5)*.0017,mouthY+dy,H[2]+.058+depth],sign=lower?1:-1;out.push(tube(`cat_${lower?'lower':'upper'}_incisor_${i}`,'cat_teeth',[c,add(c,[0,sign*.0018,0])],.00065,lod?4:6,bone,lower));}}
 for(const paw of cat.paws){const bone=`${paw.front?'front':'hind'}_${paw.side>0?'L':'R'}_paw`;for(const [i,t] of [...paw.toes,...(paw.dewclaw?[paw.dewclaw]:[])].entries()){out.push(tube(`cat_claw_${bone}_${i}`,'cat_claw',[add(t.tip,scale(t.dir,-.002)),add(t.tip,[0,.0004,0]),add(t.tip,add(scale(t.dir,.0018),[0,-.0007,0]))],.00075,lod===2?3:5,bone));}}
 for(const side of [-1,1]){const bone=`whisker_${side>0?'L':'R'}`,start=joint(rig,bone),rows=lod===2?3:6;for(let i=0;i<rows;i++){const p=add(start,[side*.0005,(i-(rows-1)/2)*.0015,.0007*Math.sin(i)]),pts:Vec3[]=[];const segments=lod===2?3:5;for(let k=0;k<=segments;k++){const t=k/segments;pts.push(add(p,[side*(.038+.008*Math.sin(i))*t,((i-(rows-1)/2)*.003)*t-.004*t*t,-.014*t*t+.007*t]));}out.push(tube(`cat_whisker_${side}_${i}`,'cat_whisker',pts,.00018,lod===0?4:3,bone));}}
 return out;
}
