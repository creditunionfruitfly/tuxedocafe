/** High density sculpt for anatomy review; never loaded by the runtime. */
import { writeFileSync } from 'node:fs';
import { Document, Accessor } from '@gltf-transform/core';
import { EXTMeshoptCompression } from '@gltf-transform/extensions';
import { reorder } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';
import { validateBytes } from 'gltf-validator';
import { io } from '../../../tools/art/gltf.ts';
import { type Mesh, vertexNormals } from './mesh-ops.ts';
import type { Anatomy } from './anatomy.ts';
import type { Rig } from './skeleton.ts';
import { details } from './details.ts';
import { provenance } from './export.ts';

export async function exportSource(mesh:Mesh,cat:Anatomy,rig:Rig,path:string){
 const doc=new Document(),b=doc.createBuffer(),scene=doc.createScene('source_sculpt'),body=doc.createMaterial('source_clay').setBaseColorFactor([.50,.47,.42,1]).setRoughnessFactor(.7),eye=doc.createMaterial('source_eye').setBaseColorFactor([.16,.22,.16,1]).setRoughnessFactor(.25);
 const entries=[{name:'source_body',...mesh},...details(cat,rig,0).filter(d=>d.name.startsWith('cat_eye_'))];
 for(const entry of entries){const p=doc.createAccessor().setBuffer(b).setType(Accessor.Type.VEC3!).setArray(Float32Array.from(entry.positions)),n=doc.createAccessor().setBuffer(b).setType(Accessor.Type.VEC3!).setArray(vertexNormals(entry.positions,entry.indices)),i=doc.createAccessor().setBuffer(b).setType(Accessor.Type.SCALAR!).setArray(entry.indices.slice());
  const primitive=doc.createPrimitive().setAttribute('POSITION',p).setAttribute('NORMAL',n).setIndices(i).setMaterial(entry.name==='source_body'?body:eye);scene.addChild(doc.createNode(entry.name).setMesh(doc.createMesh(entry.name).addPrimitive(primitive)));
 }
 await doc.transform(reorder({encoder:MeshoptEncoder,target:'size'}));doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({method:EXTMeshoptCompression.EncoderMethod.QUANTIZE});
 const bytes=await io.writeBinary(doc),validation=await validateBytes(bytes,{maxIssues:100});if(validation.issues.numErrors)throw new Error(`${path}: ${JSON.stringify(validation.issues.messages)}`);
 writeFileSync(path,bytes);writeFileSync(path+'.prov.yaml',provenance('art/cats/master/anatomy.ts','High density original sculpt for anatomy review only; static, not a runtime asset.'));
 return {triangles:entries.reduce((n,m)=>n+m.indices.length/3,0),bytes:bytes.length,errors:validation.issues.numErrors,warnings:validation.issues.numWarnings};
}
