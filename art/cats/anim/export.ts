// Writes the skeleton (rest pose, exact names and order) and one glTF
// animation per clip: rotation tracks, plus root and pelvis translation only
// where the clip needs them. Keys sit on the 30 fps grid; redundant keys are
// dropped only where linear (slerp) interpolation reproduces the sampled pose.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { Accessor, Document } from '@gltf-transform/core';
import { EXTMeshoptCompression } from '@gltf-transform/extensions';
import { MeshoptEncoder } from 'meshoptimizer';
import { validateBytes } from 'gltf-validator';
import { Quaternion } from 'three';
import { io } from '../../../tools/art/gltf.ts';
import type { Built } from './catalog.ts';
import type { Rig } from './rig.ts';

export const ROT_TOLERANCE = 0.0012;   // rad (0.07°) of slerp error allowed when dropping a key
export const POS_TOLERANCE = 0.0002;   // m

function reduce(times: number[], values: number[][], err: (a: number[], b: number[], c: number[], s: number) => number, tol: number) {
  const keep = [0];
  let k = 0;
  while (k < times.length - 1) {
    let j = k + 1;
    for (let cand = k + 2; cand < times.length; cand++) {
      let ok = true;
      for (let m = k + 1; m < cand && ok; m++) {
        const s = (times[m]! - times[k]!) / (times[cand]! - times[k]!);
        if (err(values[k]!, values[cand]!, values[m]!, s) > tol) ok = false;
      }
      if (!ok) break;
      j = cand;
    }
    keep.push(j);
    k = j;
  }
  return keep;
}

const qa = new Quaternion(), qb = new Quaternion(), qm = new Quaternion();
const rotErr = (a: number[], b: number[], m: number[], s: number) => {
  qa.fromArray(a); qb.fromArray(b); qm.fromArray(m);
  return qa.slerp(qb, s).angleTo(qm);
};
const posErr = (a: number[], b: number[], m: number[], s: number) =>
  Math.hypot(...a.map((v, i) => v + (b[i]! - v) * s - m[i]!));

export async function writeAnimations(rig: Rig, clips: Built[], path: string) {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const scene = doc.createScene('Cat animation library');
  const nodes = rig.names.map((name, i) => doc.createNode(name).setTranslation(rig.offset[i]!.toArray() as [number, number, number]));
  nodes.forEach((node, i) => { const p = rig.parent[i]!; if (p < 0) scene.addChild(node); else nodes[p]!.addChild(node); });
  doc.getRoot().setDefaultScene(scene);
  const inputs = new Map<string, Accessor>();
  const input = (times: number[]) => {
    const key = times.map(t => t.toFixed(5)).join(',');
    let acc = inputs.get(key);
    if (!acc) inputs.set(key, acc = doc.createAccessor().setBuffer(buffer).setType('SCALAR').setArray(new Float32Array(times)));
    return acc;
  };
  let keys = 0;
  const pelvis = rig.index('pelvis');
  for (const clip of clips) {
    const fps = 1 / clip.ctx.dt;
    const times = clip.frames.map((_, f) => Math.round(f) / fps);
    const anim = doc.createAnimation(clip.clip.name).setExtras(clip.extras);
    const add = (node: number, path: 'rotation' | 'translation', values: number[][]) => {
      const keep = path === 'rotation' ? reduce(times, values, rotErr, ROT_TOLERANCE) : reduce(times, values, posErr, POS_TOLERANCE);
      keys += keep.length;
      const out = doc.createAccessor().setBuffer(buffer).setType(path === 'rotation' ? 'VEC4' : 'VEC3')
        .setArray(new Float32Array(keep.flatMap(k => values[k]!)));
      const sampler = doc.createAnimationSampler().setInput(input(keep.map(k => times[k]!))).setOutput(out).setInterpolation('LINEAR');
      anim.addSampler(sampler).addChannel(doc.createAnimationChannel().setTargetNode(nodes[node]!).setTargetPath(path).setSampler(sampler));
    };
    for (const bone of clip.bones) {
      // Keep quaternion signs continuous so slerp takes the short way between keys.
      const values: number[][] = [];
      clip.frames.forEach(p => {
        const q = p.q[bone]!.toArray() as number[];
        const prev = values[values.length - 1];
        if (prev && prev.reduce((s, v, i) => s + v * q[i]!, 0) < 0) for (let i = 0; i < 4; i++) q[i] = -q[i]!;
        values.push(q);
      });
      add(bone, 'rotation', values);
    }
    if (clip.rootTranslation) add(0, 'translation', clip.frames.map(p => p.root.toArray()));
    if (clip.pelvisTranslation) add(pelvis, 'translation', clip.frames.map(p => p.pelvis.toArray()));
    for (const bone of clip.translated) add(bone, 'translation', clip.frames.map(p => (p.t.get(bone) ?? rig.offset[bone]!).toArray()));
  }
  await MeshoptEncoder.ready;
  if (process.env.ART_UNCOMPRESSED !== '1') {
    doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.FILTER });
  }
  const bytes = await io.writeBinary(doc);
  const report = await validateBytes(bytes, { maxIssues: 100 });
  if (report.issues.numErrors) throw new Error(`${path}: ${JSON.stringify(report.issues.messages)}`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, bytes);
  return { bytes: bytes.length, keys, warnings: report.issues.numWarnings };
}
