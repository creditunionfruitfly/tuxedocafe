/** Rebuildable source sculpt cache. Geometry changes invalidate it by their exact source digest. */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { gzipSync, gunzipSync } from 'node:zlib';
import type { Mesh } from './mesh-ops.ts';

const FILE='art/cats/master/cat_master_source.bin';
const INPUTS=['anatomy.ts','sdf.ts','mesher.ts','mesh-ops.ts','surface.ts','skeleton.ts'];
export function sourceSignature(){return createHash('sha256').update('h=0.0014; source-v1').update(Buffer.concat([...INPUTS.map(n=>readFileSync(`art/cats/master/${n}`)),readFileSync('art/rig/skeleton.json')])).digest('hex');}
export function readSculpt():Mesh|undefined{
 if(!existsSync(FILE)||process.env.CAT_REBUILD_SOURCE==='1')return;
 const b=gunzipSync(readFileSync(FILE));if(b.subarray(0,8).toString()!=='TCATMESH'||b.subarray(8,72).toString()!==sourceSignature())return;
 const np=b.readUInt32LE(72),ni=b.readUInt32LE(76),positions=new Float64Array(np),indices=new Uint32Array(ni);
 if(b.length!==80+np*8+ni*4)throw new Error('Master sculpt cache has invalid length');
 for(let i=0;i<np;i++)positions[i]=b.readDoubleLE(80+i*8);for(let i=0;i<ni;i++)indices[i]=b.readUInt32LE(80+np*8+i*4);
 return {positions,indices};
}
export function saveSculpt(mesh:Mesh){
 const b=Buffer.alloc(80+mesh.positions.length*8+mesh.indices.length*4);b.write('TCATMESH');b.write(sourceSignature(),8);b.writeUInt32LE(mesh.positions.length,72);b.writeUInt32LE(mesh.indices.length,76);
 mesh.positions.forEach((v,i)=>b.writeDoubleLE(v,80+i*8));mesh.indices.forEach((v,i)=>b.writeUInt32LE(v,80+mesh.positions.length*8+i*4));writeFileSync(FILE,gzipSync(b,{level:9}));
 writeFileSync(FILE+'.prov.yaml',`source: art/cats/master/anatomy.ts\ntool: original deterministic SDF surface nets and manifold repair\ndate: '2026-10-17'\nlicense: original\nauthor_role: artist\nnotes: Rebuildable dense sculpt; little-endian T CAT MESH geometry inside gzip, with exact source SHA256. CAT_REBUILD_SOURCE=1 regenerates.\n`);
}
