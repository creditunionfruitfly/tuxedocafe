/** Semantic regressions for the real exported mesh, beyond finite-pose/extent checks. */
import assert from 'node:assert/strict';
import { MeshoptDecoder } from 'meshoptimizer';
import { io, inverseBindMatrices } from './gltf.ts';
import { loadRig } from '../../art/cats/master/skeleton.ts';
import { MORPHS } from '../../art/cats/master/attributes.ts';
import { buildCat, eyeAngles } from '../../art/cats/master/anatomy.ts';

export async function checkCatWeights(directory='public/assets/art/cats'){
 await MeshoptDecoder.ready;
 const rig=loadRig(),cat=buildCat(rig),expectedBind=inverseBindMatrices([...rig.world.values()]),reports=[];
 for(let lod=0;lod<3;lod++){
  const doc=await io.read(`${directory}/cat_master_lod${lod}.glb`),root=doc.getRoot();
  const body=root.listNodes().find(n=>n.getName()==='cat_body')!,skin=body.getSkin()!,mesh=body.getMesh()!;
  assert.deepEqual(skin.listJoints().map(n=>n.getName()),rig.bones.map(b=>b.name),`LOD${lod} joint order`);
  assert.deepEqual(skin.getInverseBindMatrices()!.getArray(),expectedBind,`LOD${lod} inverse binds`);
  assert.deepEqual(mesh.getExtras().targetNames,[...MORPHS],`LOD${lod} morph names`);
  let hock=0,chest=0,tailCap=0,maxChestDistal=0,vertices=0,blinkVertices=0;
  const seen=new Set();
  for(const p of mesh.listPrimitives()){
   const P=p.getAttribute('POSITION')!;if(seen.has(P))continue;seen.add(P);
   const J=p.getAttribute('JOINTS_0')!,W=p.getAttribute('WEIGHTS_0')!,F=p.getAttribute('_FURFLOW')!,L=p.getAttribute('_FURLENGTH')!;
   const xyz:number[]=[],j:number[]=[],w:number[]=[],flow:number[]=[],length:number[]=[];
   for(let v=0;v<P.getCount();v++){
    P.getElement(v,xyz);J.getElement(v,j);W.getElement(v,w);F.getElement(v,flow);L.getElement(v,length);vertices++;
    assert(Math.abs(w.reduce((a,b)=>a+b,0)-1)<2e-6,`LOD${lod} vertex${v} weights not normalized`);
    assert(w.length===4&&w.every(x=>x>=0&&x<=1)&&j.every(x=>Number.isInteger(x)&&x>=0&&x<65));
    assert(Math.abs(Math.hypot(...flow)-1)<2e-5&&length[0]!>=0&&length[0]!<=1,`LOD${lod} fur attributes`);
    let tail=0,distal=0;
    for(let k=0;k<4;k++){const name=rig.bones[j[k]!]!.name;if(name.startsWith('tail_'))tail+=w[k]!;if(/^front_[LR]_(fore|wrist|paw|toe|digit)/.test(name))distal+=w[k]!;}
    const [x,y,z]=xyz;
    if(Math.abs(x!)>.025&&y!<.16&&z!<-.075){hock++;assert(tail<1e-7,`LOD${lod} calf/hock vertex${v} has tail weight ${tail}`);}
    if(Math.abs(x!)<.012&&y!>.125&&y!<.235&&z!>.05&&z!<.15){chest++;maxChestDistal=Math.max(maxChestDistal,distal);assert(distal<.12,`LOD${lod} ventral chest vertex${v} captured by distal leg: ${distal}`);}
    if(Math.abs(x!)<.02&&z!<-.28){tailCap++;assert(tail>.99999,`LOD${lod} distal tail vertex${v} has non-tail weight ${1-tail}`);}
    for(let side=0;side<2;side++){
     const eye=cat.eyes[side]!,a=eyeAngles(eye,x!,y!,z!);
     if(a.front<=0||Math.abs(a.r-eye.radius-eye.gap)>1e-5)continue;
     const delta=p.listTargets()[side]!.getAttribute('POSITION')!.getElement(v,[]),q=xyz.map((p,k)=>p+delta[k]!);
     const closed=eyeAngles(eye,q[0]!,q[1]!,q[2]!);blinkVertices++;
     assert(closed.r>eye.radius+.0004,`LOD${lod} blink enters globe`);
     assert(Math.abs(closed.v-eye.closure(closed.t))<2e-4&&closed.h>eye.inner-2e-4&&closed.h<eye.outer+2e-4,`LOD${lod} eyelid lining did not close`);
    }
   }
  }
  assert(hock>10&&chest>0&&tailCap>5&&blinkVertices>5,`LOD${lod} missing semantic test coverage: ${JSON.stringify({hock,chest,tailCap,blinkVertices})}`);
  const triangles=root.listMeshes().flatMap(m=>m.listPrimitives()).reduce((n,p)=>n+p.getIndices()!.getCount()/3,0);
  assert(triangles<=[30000,12000,4000][lod]!);
  const draws=root.listMeshes().reduce((n,m)=>n+m.listPrimitives().length,0);if(lod===2)assert.equal(draws,2);
  reports.push({lod,vertices,hock,chest,tailCap,maxChestDistal,blinkVertices,triangles,draws});
 }
 console.log(`Cat semantic skin checks: ${JSON.stringify(reports)}`);return reports;
}
if(process.argv[1]?.endsWith('/check-cat-weights.ts'))await checkCatWeights();
