/** Anatomical envelopes, expressions and tangent fur data on the shared rest surface. */
import type { Anatomy } from './anatomy.ts';
import { eyeAngles, earLocal } from './anatomy.ts';
import { type Rig, joint } from './skeleton.ts';
import { type Vec3, add, sub, scale, dot, normalize, clamp, smoothstep } from './sdf.ts';

export const MORPHS = ['blink_L','blink_R','squint_L','squint_R','mouthOpen','noseWrinkle','cheekPuff','whiskerForward','whiskerBack','earFlatten_L','earFlatten_R','bodyFat','bodyLean','headKitten'] as const;
const point = (P: ArrayLike<number>, v: number): Vec3 => [P[v*3]!,P[v*3+1]!,P[v*3+2]!];
const seg = (p: Vec3,a: Vec3,b: Vec3) => { const d=sub(b,a), t=clamp(dot(sub(p,a),d)/Math.max(dot(d,d),1e-12),0,1); return {t, distance: Math.hypot(...sub(p,add(a,scale(d,t))))}; };

export function attributes(P: Float64Array, normals: Float32Array, cat: Anatomy, rig: Rig) {
  const n=P.length/3, joints=new Uint16Array(n*4), weights=new Float32Array(n*4), flow=new Float32Array(n*3), length=new Float32Array(n);
  const J=(name:string)=>joint(rig,name), I=(name:string)=>rig.index.get(name)!;
  const spine=['pelvis','spine_01','spine_02','spine_03','spine_04','spine_05','neck_01','neck_02','head'];
  const tail=Array.from({length:12},(_,i)=>`tail_${String(i+1).padStart(2,'0')}`);
  const tip=J('tail_12'),tipEnd=add(tip,scale(normalize(sub(tip,J('tail_11'))),.032));
  const chainDistance=(p:Vec3,names:string[])=>Math.min(...names.slice(0,-1).map((name,k)=>seg(p,J(name),J(names[k+1]!)).distance));
  const chainWeights=(p:Vec3,names:string[],radius:number) => {
    const candidates = names.map((name,k)=> {const a=J(name), b=J(names[Math.min(k+1,names.length-1)]!); const d=seg(p,a,b).distance; return [I(name),1/(1+(d/radius)**4)] as [number,number];});
    const best=candidates.sort((a,b)=>b[1]-a[1]).slice(0,4),sum=best.reduce((a,b)=>a+b[1],0);return best.map(([j,w])=>[j,w/sum] as [number,number]);
  };
  for(let v=0;v<n;v++) {
    const p=point(P,v), [x,y,z]=p, s=x>=0?'L':'R';
    let ws=chainWeights(p,spine,.042), dir:Vec3=[0,-.15,-1], len=.22;
    if(z<-.205 && Math.min(chainDistance(p,tail),seg(p,tip,tipEnd).distance)<.024) {
      const tw=chainWeights(p,tail,.012),blend=smoothstep(-.205,-.232,z),all=new Map<number,number>();
      for(const [j,w] of ws)all.set(j,w*(1-blend));for(const [j,w] of tw)all.set(j,(all.get(j)??0)+w*blend);ws=[...all].sort((a,b)=>b[1]-a[1]).slice(0,4);
      const i=tail.indexOf(rig.bones[tw[0]![0]]!.name);dir=normalize(sub(J(tail[Math.min(i+1,11)]!),J(tail[Math.max(i-1,0)]!)));len=.35;
    } else if(y<.235 && (z>.015 || z<-.07)) {
      const front=z>.015, pre=`${front?'front':'hind'}_${s}_`;
      const names=front?['scapula','upper','fore','wrist','paw','toe']:['hip','thigh','shin','hock','metatarsal','paw','toe'];
      const chain=names.map(a=>pre+a),lw=chainWeights(p,chain,.015),distance=chainDistance(p,chain),radius=.019+.013*smoothstep(.14,.235,y);
      const sideGate=1-smoothstep(.07,.12,y)*(1-smoothstep(.012,.023,Math.abs(x)));
      const mix=smoothstep(front?.238:.25,front?.14:.16,y)*(1-smoothstep(radius*.7,radius*1.65,distance))*sideGate;
      const all=new Map<number,number>();
      for(const [j,w] of ws)all.set(j,w*(1-mix));for(const [j,w] of lw)all.set(j,(all.get(j)??0)+w*mix);
      ws=[...all].sort((a,b)=>b[1]-a[1]).slice(0,4);dir=[0,-1,.2];len=.13;
      // The plantar skin belongs to the paw: no remote torso influence on a planted pad.
      if(y<.024){ws=[[I(pre+'paw'),1]];dir=[0,-.15,1];len=.09;}
    }
    const neckBlend=smoothstep(.135,.185,z)*smoothstep(.245,.285,y);
    if(neckBlend>0) {
      const all=new Map<number,number>();for(const [j,w] of ws)all.set(j,w*(1-neckBlend));all.set(I('head'),(all.get(I('head'))??0)+neckBlend*2);ws=[...all].sort((a,b)=>b[1]-a[1]).slice(0,4);
      dir=normalize([x*8,.25,-.8]);len=.18;
      const jaw=smoothstep(.225,.245,z)*(1-smoothstep(cat.mouth.slitY(x,z)-.002,cat.mouth.slitY(x,z)+.0005,y));
      if(jaw>.001)ws=[[I('jaw'),jaw],[I('head'),1-jaw]];
    }
    for(const ear of cat.ears){const e=earLocal(ear,x,y,z);if(e.h>.004&&Math.abs(e.n-e.mid)<.008&&e.outline<.003){const a=smoothstep(.003,.018,e.h),b=smoothstep(.016,.040,e.h);ws=[[I('head'),1-a],[I(`ear_${ear.side>0?'L':'R'}_01`),a*(1-b)],[I(`ear_${ear.side>0?'L':'R'}_02`),a*b]];dir=ear.up;len=.14;}}
    ws=ws.filter(([,w])=>w>1e-7);const sum=ws.reduce((s2,[,w])=>s2+w,0); ws.forEach(([j,w],k)=>{joints[v*4+k]=j;weights[v*4+k]=w/sum;});
    const normal=point(normals,v), t=sub(dir,scale(normal,dot(dir,normal)));let tangent=normalize(t);
    if(Math.hypot(...t)<1e-7)tangent=normalize(Math.abs(normal[0])<.8?[0,normal[2],-normal[1]]:[normal[2],0,-normal[0]]);
    flow.set(tangent,v*3);length[v]=len;
    if(z>.245||y<.008)length[v]=.025;
  }
  const morphs=new Map<string,Float32Array>();
  for(const name of MORPHS) {
    const out=new Float32Array(n*3);
    for(let v=0;v<n;v++) {
      const p=point(P,v), [x,y,z]=p;let q:Vec3=[...p];
      if(name.startsWith('blink')||name.startsWith('squint')) {
        const eye=cat.eyes[name.endsWith('_L')?0:1],a=eyeAngles(eye,...p), r=a.r;
        if(a.front>0&&r<.032&&a.h>eye.inner-.50&&a.h<eye.outer+.50) {
          const closure=eye.closure(a.t), strength=(name.startsWith('squint')?.48:1)*(1-smoothstep(.014,.030,r));
          const dh=Math.min(a.h-eye.inner,eye.outer-a.h), edge=smoothstep(-.50,-.20,dh);
          const above=a.v>=closure, extent=above?a.upper:a.lower, fall=above?1-smoothstep(extent+.20,extent+.90,a.v):smoothstep(extent-.90,extent-.20,a.v);
          const lining=1-smoothstep(eye.radius+eye.gap+.0001,eye.radius+eye.gap+.0010,r);
          const blend=strength*Math.max(lining,edge*fall),vv=a.v+(closure-a.v)*blend,hh=a.h+(clamp(a.h,eye.inner,eye.outer)-a.h)*blend,cv=Math.cos(vv),d=add(add(scale(eye.axis,Math.cos(hh)*cv),scale(eye.lateral,Math.sin(hh)*cv)),scale(eye.up,Math.sin(vv)));
          q=add(eye.center,scale(d,Math.max(r,eye.radius+eye.gap)));
        }
      } else if(name==='mouthOpen') {
        // The jaw joint owns hinge rotation. This shape supplies lip roll and corner
        // stretch only, so clips may layer the catalogued morph without double-opening.
        const lip=cat.mouth.slitY(x,z),front=smoothstep(.208,.242,z),near=Math.exp(-(((y-lip)/.006)**2)),lower=y<lip;
        q=add(p,[Math.sign(x)*.0014*front*near,(lower?-.0015:.0020)*front*near,-.0005*front*near]);
      } else if(name==='noseWrinkle') {
        const a=Math.exp(-((x/.012)**2+((z-.246)/.018)**2+((y-.305)/.018)**2));q=add(p,[0,.003*a,-.002*a]);
      } else if(name==='cheekPuff') {
        const a=Math.exp(-(((Math.abs(x)-.017)/.012)**2+((z-.233)/.02)**2+((y-.294)/.017)**2));q=add(p,[Math.sign(x)*.004*a,.001*a,.002*a]);
      } else if(name.startsWith('whisker')) {
        const a=Math.exp(-(((Math.abs(x)-.011)/.012)**2+((z-.245)/.015)**2+((y-.290)/.013)**2));q=add(p,[Math.sign(x)*.001*a,0,(name==='whiskerForward'?.002:-.002)*a]);
      } else if(name.startsWith('earFlatten')) {
        const ear=cat.ears[name.endsWith('_L')?0:1],e=earLocal(ear,...p); if(e.outline<.008&&Math.abs(e.n-e.mid)<.015&&e.h>0){const a=smoothstep(0,.035,e.h);q=add(p,[ear.side*.016*a,-.020*a,-.016*a]);}
      } else if(name==='bodyFat'||name==='bodyLean') {
        const a=(1-smoothstep(.135,.20,z))*smoothstep(.12,.23,y)*(1-smoothstep(.205,.25,-z)),s=name==='bodyFat'?1:-.55;q=add(p,[x*.22*a*s,-.017*a*s,0]);
      } else if(name==='headKitten') {
        const a=smoothstep(.145,.195,z)*smoothstep(.255,.29,y),h=cat.landmarks.head!;q=add(p,[x*.13*a,(y-h[1])*.11*a,-Math.max(z-h[2]-.035,0)*.12*a]);
      }
      out.set(sub(q,p),v*3);
    }
    morphs.set(name,out);
  }
  return {joints,weights,flow,length,morphs};
}
