/** Deterministic master-cat asset pipeline. CAT_FAST_REVIEW bypasses UV authoring for geometry review only. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { deserialize, serialize } from 'node:v8';
import { MeshoptSimplifier } from 'meshoptimizer';
import { loadRig } from './skeleton.ts';
import { buildCat, eyeAngles } from './anatomy.ts';
import { denseSurface, openEyes, simplify } from './surface.ts';
import { faceLabels, vertexLabels } from './labels.ts';
import { type Mesh, compact, topologyOf, faceNormal, vertexNeighbours } from './mesh-ops.ts';
import { buildAtlas, type UVResult } from './uv.ts';
import { exportCat, provenance } from './export.ts';
import { guides } from './guides.ts';
import { readSculpt, saveSculpt } from './cache.ts';
import { exportSource } from './source.ts';
import { checkCatWeights } from '../../../tools/art/check-cat-weights.ts';
import { refineLids } from './lids.ts';

export async function makeMasterCat() {
 await MeshoptSimplifier.ready;
 const rig=loadRig(),cat=buildCat(rig),cache=process.env.CAT_SOURCE_CACHE;
 const dense:Mesh=cache&&existsSync(cache)?deserialize(readFileSync(cache)) as Mesh:readSculpt()??openEyes(denseSurface(cat,.0014),cat.eyes);
 if(cache&&!existsSync(cache))writeFileSync(cache,serialize(dense));
 saveSculpt(dense);
 const importance=Float32Array.from({length:dense.positions.length/3},(_,v)=>{
  const y=dense.positions[v*3+1]!,z=dense.positions[v*3+2]!;return z>.17?3.5:y<.035?3:1;
 });
 const body=simplify(dense,23800,importance,{weight:.08}).mesh;
 const labels=faceLabels(body,vertexLabels(body,cat,rig));
 let atlas:UVResult;
 if(process.env.CAT_FAST_REVIEW==='1')atlas={...body,uv:Float32Array.from({length:body.positions.length/3*2},(_,k)=>k%2?body.positions[Math.floor(k/2)*3+1]!/.4:(body.positions[Math.floor(k/2)*3+2]!+.45)/.75),source:Uint32Array.from({length:body.positions.length/3},(_,i)=>i),faceChart:labels.chart,faceSurface:labels.surface,islands:[],swatch:[0,0,0,0],texelsPerMeter:0};
 else atlas=buildAtlas(body,labels);
 // Facial booleans are only millimetres wide. Locally fair the simplified
 // sculpt after unwrapping, using source indices to move every UV duplicate
 // identically. Preserve the lid margin and the approved UV coordinates.
 fairFace(body,cat);
 sealLips(body,cat);
 for(let v=0;v<atlas.source.length;v++)atlas.positions.set(body.positions.subarray(atlas.source[v]!*3,atlas.source[v]!*3+3),v*3);
 refineLids(atlas.positions,cat);
 // A thin chin can lie close to the cavity field without being an interior face.
 // Keep its exterior fur-coloured; this refines material IDs without changing UVs.
 for(let f=0;f<atlas.faceSurface.length;f++)if(atlas.faceSurface[f]===4){
  const ids=[atlas.indices[f*3]!,atlas.indices[f*3+1]!,atlas.indices[f*3+2]!],N=[0,0,0];faceNormal(atlas.positions,ids[0]!,ids[1]!,ids[2]!,N);
  const center=[0,1,2].map(k=>ids.reduce((s,v)=>s+atlas.positions[v*3+k]!,0)/3);
  if(N.reduce((s,n,k)=>s+n*(cat.mouth.cavity.center[k]!-center[k]!),0)<=0)atlas.faceSurface[f]=0;
 }
 const out=process.env.CAT_MASTER_OUT??'public/assets/art/cats';mkdirSync(out,{recursive:true});
 const results=[];
 if(process.env.CAT_FAST_REVIEW!=='1')await guides(atlas,'art/cats/master/notes');
 results.push(await exportCat(atlas,cat,rig,0,`${out}/cat_master_lod0.glb`,30000));
 if(process.env.CAT_FAST_REVIEW==='1')return results;
 for(const [lod,target,budget] of [[1,9200,12000],[2,3400,4000]]) {
  const attr=new Float32Array(atlas.source.length*2);attr.set(atlas.uv);
  const [indices]=MeshoptSimplifier.simplifyWithAttributes(atlas.indices,Float32Array.from(atlas.positions),3,attr,2,[.02,.02],null,target!*3,1,['RegularizeLight']);
  const reduced=compact({positions:atlas.positions,indices}),uv=new Float32Array(reduced.inverse.length*2),source=new Uint32Array(reduced.inverse.length);
  reduced.inverse.forEach((old,v)=>{uv.set(atlas.uv.subarray(old*2,old*2+2),v*2);source[v]=atlas.source[old]!;});
  // Surface labels remain vertex-local because atlas material seams split the index topology.
  const surfaceV=new Uint8Array(atlas.source.length),chartV=new Uint8Array(atlas.source.length);
  for(let f=0;f<atlas.indices.length/3;f++)for(let k=0;k<3;k++){surfaceV[atlas.indices[f*3+k]!]=atlas.faceSurface[f]!;chartV[atlas.indices[f*3+k]!]=atlas.faceChart[f]!;}
  const faceSurface=new Uint8Array(indices.length/3),faceChart=new Uint8Array(indices.length/3);
  for(let f=0;f<indices.length/3;f++){faceSurface[f]=surfaceV[indices[f*3]!]!;faceChart[f]=chartV[indices[f*3]!]!;}
  const a:UVResult={...atlas,...reduced.mesh,uv,source,faceSurface,faceChart};results.push(await exportCat(a,cat,rig,lod!,`${out}/cat_master_lod${lod}.glb`,budget!));
 }
 const topo=topologyOf(body.indices,body.positions.length/3);
 const sculpt=simplify(dense,220000,Float32Array.from({length:dense.positions.length/3},()=>1),{weight:.08}).mesh;
 fairFace(sculpt,cat);
 sealLips(sculpt,cat);
 refineLids(sculpt.positions,cat);
 const source=await exportSource(sculpt,cat,rig,`${out}/cat_master_source.glb`);
 const skinChecks=await checkCatWeights(out);
 const report={version:1,rigJoints:rig.bones.length,sourceTriangles:dense.indices.length/3,source,skinChecks,bodyTopology:{...topo,loops:topo.loops.map(l=>l.length)},atlas:{islands:atlas.islands,texelsPerMeter:atlas.texelsPerMeter},lods:results};
 writeFileSync(`${out}/cat_master_qa.json`,JSON.stringify(report,null,2)+'\n');writeFileSync(`${out}/cat_master_qa.json.prov.yaml`,provenance('art/cats/master/generate.ts'));
 return results;
}
function fairFace(mesh:Mesh,cat:ReturnType<typeof buildCat>){
 const P=mesh.positions,nb=vertexNeighbours(mesh.indices,P.length/3),C=cat.nose.center,H=cat.landmarks.head!;
 const ramp=(a:number,b:number,t:number)=>{const x=Math.max(0,Math.min(1,(t-a)/(b-a)));return x*x*(3-2*x);};
 const mask=new Float64Array(P.length/3);
 for(let v=0;v<mask.length;v++){
  const d=Math.hypot((P[v*3]!-C[0])/.013,(P[v*3+1]!-C[1])/.011,(P[v*3+2]!-C[2])/.014);
  mask[v]=Math.max(0,1-d*d)**2;
  const lip=Math.hypot(P[v*3]!/.022,(P[v*3+1]!-H[1]+.018)/.014,(P[v*3+2]!-H[2]-.067)/.023);
  mask[v]=Math.max(mask[v]!,.80*Math.max(0,1-lip*lip)**2);
  for(const e of cat.eyes){const a=eyeAngles(e,P[v*3]!,P[v*3+1]!,P[v*3+2]!);
   if(a.front>0)mask[v]=Math.max(mask[v]!, .8*ramp(.0122,.016,a.r)*(1-ramp(.027,.032,a.r)));
  }
 }
 for(let round=0;round<7;round++)for(const strength of [.48,-.50]){
  const next=P.slice();
  for(let v=0;v<mask.length;v++){
   const start=nb.start[v]!,end=nb.start[v+1]!,weight=strength*mask[v]!;
   if(!weight||end===start)continue;
   for(let k=0;k<3;k++){
    let sum=0;for(let n=start;n<end;n++)sum+=P[nb.list[n]!*3+k]!;
    next[v*3+k]=P[v*3+k]!+weight*(sum/(end-start)-P[v*3+k]!);
   }
  }
  P.set(next);
 }
}
/** Raise only the exterior lower lip toward the upper lip in the bind pose.
 * The jaw bone still swings it open, and the mouthOpen target rolls its edge. */
function sealLips(mesh:Mesh,cat:ReturnType<typeof buildCat>){
 const P=mesh.positions;
 const ramp=(a:number,b:number,t:number)=>{const x=Math.max(0,Math.min(1,(t-a)/(b-a)));return x*x*(3-2*x);};
 for(let v=0;v<P.length/3;v++){
  const x=P[v*3]!,y=P[v*3+1]!,z=P[v*3+2]!,lip=cat.mouth.slitY(x,z),gap=lip-y;
  if(gap<=.00015||gap>.016||cat.mouth.arch(x,z)>.002)continue;
  const front=ramp(.219,.232,z)*(1-ramp(.010,.015,Math.abs(x)));
  const near=Math.exp(-((gap/.010)**2));
  P[v*3+1]=y+Math.max(0,gap-.00015)*.98*front*near;
 }
}
if(process.argv[1]?.endsWith('/master/generate.ts'))await makeMasterCat();
