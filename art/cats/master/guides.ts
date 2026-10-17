/** Texture authoring guides in the exact exported shared atlas (PNG origin top-left). */
import { mkdirSync, writeFileSync } from 'node:fs';
import { png } from './png.ts';
import type { UVResult } from './uv.ts';
import { CHARTS, SURFACES } from './labels.ts';
import { vertexNormals } from './mesh-ops.ts';
import { provenance } from './export.ts';
export async function guides(a:UVResult,out:string){mkdirSync(out,{recursive:true});const size=2048,chart=new Uint8Array(size*size*4).fill(255),position=new Uint8Array(chart.length),normal=new Uint8Array(chart.length),surface=new Uint8Array(chart.length),normals=vertexNormals(a.positions,a.indices);
 const colors=CHARTS.map((_,i)=>{const h=i/CHARTS.length*6,c=.55,x=c*(1-Math.abs(h%2-1)),rgb=h<1?[c,x,0]:h<2?[x,c,0]:h<3?[0,c,x]:h<4?[0,x,c]:h<5?[x,0,c]:[c,0,x];return rgb.map(v=>Math.round((v+.28)*255));});
 for(let f=0;f<a.indices.length/3;f++){const ids=[a.indices[f*3]!,a.indices[f*3+1]!,a.indices[f*3+2]!],p=ids.map(v=>[a.uv[v*2]!*size,a.uv[v*2+1]!*size]),den=(p[1]![1]!-p[2]![1]!)*(p[0]![0]!-p[2]![0]!)+(p[2]![0]!-p[1]![0]!)*(p[0]![1]!-p[2]![1]!);if(Math.abs(den)<1e-10)continue;
 const minX=Math.max(0,Math.floor(Math.min(...p.map(p=>p[0]!)))),maxX=Math.min(size-1,Math.ceil(Math.max(...p.map(p=>p[0]!)))),minY=Math.max(0,Math.floor(Math.min(...p.map(p=>p[1]!)))),maxY=Math.min(size-1,Math.ceil(Math.max(...p.map(p=>p[1]!))));
 for(let y=minY;y<=maxY;y++)for(let x=minX;x<=maxX;x++){const u=((p[1]![1]!-p[2]![1]!)*(x+.5-p[2]![0]!)+(p[2]![0]!-p[1]![0]!)*(y+.5-p[2]![1]!))/den,v=((p[2]![1]!-p[0]![1]!)*(x+.5-p[2]![0]!)+(p[0]![0]!-p[2]![0]!)*(y+.5-p[2]![1]!))/den,w=1-u-v;if(Math.min(u,v,w)<-1e-7)continue;const at=(y*size+x)*4,bary=[u,v,w],P=[0,0,0],N=[0,0,0];for(let i=0;i<3;i++)for(let k=0;k<3;k++){P[k]!+=a.positions[ids[i]!*3+k]!*bary[i]!;N[k]!+=normals[ids[i]!*3+k]!*bary[i]!;}chart.set([...colors[a.faceChart[f]!]!,255],at);position.set([Math.round((P[0]!+.1)/.2*255),Math.round(P[1]!/.4*255),Math.round((P[2]!+.42)/.7*255),255],at);normal.set([...N.map(n=>Math.round((n*.5+.5)*255)),255],at);surface.set([a.faceSurface[f]!,a.faceChart[f]!,0,255],at);}}
 for(const [name,pix] of [['uv_template',chart],['uv_position',position],['uv_normal',normal],['uv_surface',surface]] as [string,Uint8Array][]){const path=`${out}/${name}.png`;writeFileSync(path,png(size,size,pix));writeFileSync(path+'.prov.yaml',provenance('art/cats/master/guides.ts','Exact diagnostic raster from the exported atlas; not generated concept imagery.'));}
 writeFileSync(`${out}/atlas.json`,JSON.stringify({version:1,size,origin:'top-left PNG; glTF UV v=y/size; texture.flipY=false',charts:CHARTS,surfaces:SURFACES,positionDecode:{x:'R/255*.2-.1',y:'G/255*.4',z:'B/255*.7-.42'},islands:a.islands,texelsPerMeter:a.texelsPerMeter,positions:Array.from(a.positions),indices:Array.from(a.indices),uv:Array.from(a.uv),faceSurface:Array.from(a.faceSurface),faceChart:Array.from(a.faceChart)}));
 writeFileSync(`${out}/atlas.json.prov.yaml`,provenance('art/cats/master/guides.ts','Exact geometry, UV and chart metadata for the exported shared atlas.'));
}
