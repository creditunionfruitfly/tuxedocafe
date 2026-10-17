/** Shared skin, named morphs and material partitions exported as validated meshopt GLB. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { Document, Accessor, type Material } from '@gltf-transform/core';
import { dedup, reorder, quantize } from '@gltf-transform/functions';
import { EXTMeshoptCompression, KHRMeshQuantization } from '@gltf-transform/extensions';
import { MeshoptEncoder } from 'meshoptimizer';
import { validateBytes } from 'gltf-validator';
import { io, inverseBindMatrices } from '../../../tools/art/gltf.ts';
import { vertexNormals } from './mesh-ops.ts';
import { attributes, MORPHS } from './attributes.ts';
import type { UVResult } from './uv.ts';
import { earLocal, type Anatomy } from './anatomy.ts';
import type { Rig } from './skeleton.ts';
import { smoothstep } from './sdf.ts';
import { details, type Detail } from './details.ts';
import { placeholderEye } from './png.ts';
export const provenance=(source:string,notes='Original deterministic feline anatomy and surface authoring; no third-party geometry or image assets.')=>`source: ${source}\ntool: original procedural TypeScript; glTF Transform; meshoptimizer\ndate: '2026-10-17'\nlicense: original\nauthor_role: artist\nnotes: ${notes}\n`;

export async function exportCat(atlas:UVResult,cat:Anatomy,rig:Rig,lod:number,path:string,budget:number) {
 const doc=new Document(),buffer=doc.createBuffer(),scene=doc.createScene('master_cat');
 const A=(name:string,array:Float32Array|Uint16Array|Uint32Array,type:string)=>doc.createAccessor(name).setBuffer(buffer).setType(type as NonNullable<typeof Accessor.Type.VEC3>).setArray(array.slice());
 const V3=Accessor.Type.VEC3!,V2=Accessor.Type.VEC2!,V4=Accessor.Type.VEC4!,SCALAR=Accessor.Type.SCALAR!;
 const bones=rig.bones.map(b=>doc.createNode(b.name).setTranslation(b.restPosition));
 rig.bones.forEach((b,i)=>{if(b.parent===null)scene.addChild(bones[i]!);else bones[rig.index.get(b.parent)!]!.addChild(bones[i]!);});
 const skin=doc.createSkin('cat_shared_65').setSkeleton(bones[0]!).setInverseBindMatrices(A('inverse_bind',inverseBindMatrices([...rig.world.values()]),Accessor.Type.MAT4!));bones.forEach(b=>skin.addJoint(b));
 const mat=new Map<string,Material>();
 for(const [name,color,roughness] of [
  ['cat_fur',[1,1,1,1],.88],['cat_nose_leather',[1,1,1,1],.42],['cat_paw_pads',[1,1,1,1],.62],['cat_inner_ear',[1,1,1,1],.85],['cat_mouth',[1,1,1,1],.5],['cat_teeth',[.86,.82,.66,1],.32],['cat_claw',[.61,.55,.41,1],.3],['cat_eye',[1,1,1,1],.28],['cat_cornea',[1,1,1,.13],.035],['cat_whisker',[.68,.65,.57,1],.7]
 ] as [string,[number,number,number,number],number][])mat.set(name,doc.createMaterial(name).setBaseColorFactor(color).setRoughnessFactor(roughness).setMetallicFactor(0));
 const eye=doc.createTexture('original_neutral_iris').setImage(placeholderEye()).setMimeType('image/png');mat.get('cat_eye')!.setBaseColorTexture(eye);mat.get('cat_cornea')!.setAlphaMode('BLEND').setDoubleSided(false);
 const normals=vertexNormals(atlas.positions,atlas.indices,weldMap(atlas.positions)),attrs=attributes(atlas.positions,normals,cat,rig);
 const p=A('body_position',Float32Array.from(atlas.positions),V3),n=A('body_normal',normals,V3),uv=A('body_uv',atlas.uv,V2),j=A('body_joints',attrs.joints,V4),w=A('body_weights',attrs.weights,V4),f=A('body_furflow',attrs.flow,V3),l=A('body_furlength',attrs.length,SCALAR);
 const targets=MORPHS.map(name=>{const delta=attrs.morphs.get(name)!,moved=atlas.positions.slice();for(let k=0;k<moved.length;k++)moved[k]!+=delta[k]!;const mn=vertexNormals(moved,atlas.indices,weldMap(moved));for(let k=0;k<mn.length;k++)mn[k]!-=normals[k]!;return {name,p:A(name,delta,V3),n:A(name+'_normal',mn,V3)};});
 const mesh=doc.createMesh('cat_body').setExtras({targetNames:[...MORPHS],atlasVersion:1});
 const surfaceV=new Float32Array(atlas.source.length);for(let f=0;f<atlas.indices.length/3;f++)for(let k=0;k<3;k++)surfaceV[atlas.indices[f*3+k]!]=atlas.faceSurface[f]!;
 // Anatomical paint is evaluated at vertices, including both copies of a UV/material seam.
 // A flat colour per face made the tiny nose and inner-ear borders sawtoothed at game distance.
 // Keep material partitions and _SURFACE for resident masks, but blend the neutral lookdev tint
 // across those borders without moving geometry or changing the already approved UV atlas.
 const color=new Float32Array(atlas.source.length*3),fur=[.50,.47,.42],nose=[.23,.105,.10],pad=[.20,.105,.115],earColor=[.48,.28,.26],mouth=[.095,.028,.034];
 const pads=Object.entries(cat.labels).filter(([key])=>key.endsWith('.pads')).map(([,shape])=>shape);
 for(let v=0;v<surfaceV.length;v++){
  const x=atlas.positions[v*3]!,y=atlas.positions[v*3+1]!,z=atlas.positions[v*3+2]!;
  const mixColor=(target:number[],t:number)=>{for(let k=0;k<3;k++)color[v*3+k]=color[v*3+k]!*(1-t)+target[k]!*t;};
  color.set(fur,v*3);
  const pd=Math.min(...pads.map(s=>s.eval(x,y,z)));
  if(y<.065)mixColor(pad,1-smoothstep(-.0007,.0014,pd));
  for(const e of cat.ears){const a=earLocal(e,x,y,z);
   const t=(1-smoothstep(-.0016,.0012,a.outline))*smoothstep(.003,.008,a.h)*smoothstep(-.0001,.0018,a.n-a.mid);
   mixColor(earColor,t);
  }
  mixColor(nose,1-smoothstep(-.0003,.0025,cat.labels.noseLeather!.eval(x,y,z)));
  // Only the cavity is dark. The front edge of the closed lip is ordinary
  // skin; painting every mouth-chart triangle dark made a false open grin.
  if(surfaceV[v]===4)mixColor(mouth,.9*smoothstep(.241,.225,z));
 }
 const surfaceA=A('surface_id',surfaceV,SCALAR),colorA=A('surface_tint',color,V3);
 const surfaces=['cat_fur','cat_nose_leather','cat_paw_pads','cat_inner_ear','cat_mouth'];
 for(let s=0;s<(lod>0?1:surfaces.length);s++){const idx:number[]=[];for(let t=0;t<atlas.indices.length/3;t++)if(lod>0||atlas.faceSurface[t]===s)idx.push(...atlas.indices.subarray(t*3,t*3+3));if(!idx.length)continue;
  const prim=doc.createPrimitive().setMaterial(mat.get(surfaces[s]!)!).setIndices(A('indices_'+s,Uint32Array.from(idx),SCALAR)).setAttribute('POSITION',p).setAttribute('NORMAL',n).setAttribute('TEXCOORD_0',uv).setAttribute('JOINTS_0',j).setAttribute('WEIGHTS_0',w).setAttribute('_FURFLOW',f).setAttribute('_FURLENGTH',l);
  prim.setAttribute('COLOR_0',colorA);
  if(lod>0)prim.setAttribute('_SURFACE',surfaceA);
  for(const target of targets)prim.addTarget(doc.createPrimitiveTarget(target.name).setAttribute('POSITION',target.p).setAttribute('NORMAL',target.n));mesh.addPrimitive(prim);
 }
 scene.addChild(doc.createNode('cat_body').setMesh(mesh).setSkin(skin));
 const parts=details(cat,rig,lod).filter(p=>lod<2||p.name.startsWith('cat_eye_'));const groups=new Map<string,Detail[]>();
 for(const part of parts){const key=lod===2&&part.name.startsWith('cat_eye')?'cat_eyes':part.name.startsWith('cat_eye')||part.name.startsWith('cat_cornea')?part.name:part.material;if(!groups.has(key))groups.set(key,[]);groups.get(key)!.push(part);}
 for(const [name,ds] of groups){const count=ds.reduce((s,d)=>s+d.positions.length/3,0),P=new Float64Array(count*3),UV=new Float32Array(count*2),J=new Uint16Array(count*4),W=new Float32Array(count*4),I:number[]=[];let off=0;
  for(const d of ds){P.set(d.positions,off*3);UV.set(d.uv,off*2);for(let v=0;v<d.positions.length/3;v++){J[(off+v)*4]=rig.index.get(d.bone)!;W[(off+v)*4]=1;}for(const v of d.indices)I.push(v+off);off+=d.positions.length/3;}
  const idx=Uint32Array.from(I),prim=doc.createPrimitive().setMaterial(mat.get(ds[0]!.material)!).setIndices(A(name+'_indices',idx,SCALAR)).setAttribute('POSITION',A(name+'_position',Float32Array.from(P),V3)).setAttribute('NORMAL',A(name+'_normal',vertexNormals(P,idx,weldMap(P)),V3)).setAttribute('TEXCOORD_0',A(name+'_uv',UV,V2)).setAttribute('JOINTS_0',A(name+'_joints',J,V4)).setAttribute('WEIGHTS_0',A(name+'_weights',W,V4));
  const dm=doc.createMesh(name).addPrimitive(prim);
  scene.addChild(doc.createNode(name).setMesh(dm).setSkin(skin));
 }
 await MeshoptEncoder.ready;await doc.transform(dedup());
 // Position quantization rewrites inverse binds per mesh/LOD. Preserve exact metre-space
 // positions, skin weights and morphs; quantize normals/UV only, then meshopt the bytes.
 if(process.env.ART_UNCOMPRESSED!=='1'){
  await doc.transform(reorder({encoder:MeshoptEncoder,target:'size'}),quantize({pattern:/^(NORMAL|TEXCOORD|JOINTS|COLOR)(_\d+)?$/,patternTargets:/^$/,quantizeNormal:12,quantizeTexcoord:16}));
  doc.createExtension(KHRMeshQuantization).setRequired(true);
  doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({method:EXTMeshoptCompression.EncoderMethod.QUANTIZE});
 }
 const bytes=await io.writeBinary(doc),report=await validateBytes(bytes,{maxIssues:100});if(report.issues.numErrors)throw new Error(`${path}: ${JSON.stringify(report.issues.messages)}`);
 const triangles=doc.getRoot().listMeshes().flatMap(m=>m.listPrimitives()).reduce((s,p)=>s+(p.getIndices()?.getCount()??0)/3,0);
 if(triangles>budget)throw new Error(`${path}: ${triangles}>${budget} triangles`);
 mkdirSync(dirname(path),{recursive:true});writeFileSync(path,bytes);writeFileSync(path+'.prov.yaml',provenance('art/cats/master/generate.ts'));
 console.log(`${path}: ${triangles} triangles, ${bytes.length} bytes, ${report.issues.numWarnings} warnings, validator 0 errors`);
 return {lod,triangles,bytes:bytes.length,warnings:report.issues.numWarnings};
}
/** Position weld used only for normals, so UV/material splits cannot create shading seams. */
export function weldMap(p:Float64Array){const seen=new Map<string,number>(),map=new Uint32Array(p.length/3);for(let v=0;v<map.length;v++){const key=`${p[v*3]!.toFixed(8)},${p[v*3+1]!.toFixed(8)},${p[v*3+2]!.toFixed(8)}`;if(!seen.has(key))seen.set(key,v);map[v]=seen.get(key)!;}return map;}
