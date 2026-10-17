// Audit the actual reduced, meshopt-compressed library rather than its source samples.
// node art/cats/anim/inspect-export.ts [cat_anims.glb]
// CAT_MAX_TURN_DEG overrides the hard per-frame half-turn guard for development.
import { readFileSync } from 'node:fs';
import { Quaternion, Vector3 } from 'three';
import { MeshoptDecoder } from 'meshoptimizer';
import { io } from '../../../tools/art/gltf.ts';
import { loadCatalog } from './catalog.ts';
import { LEGS, fk, loadRig, restPose } from './rig.ts';

export async function inspectExport(filename = 'public/assets/art/cats/cat_anims.glb') {
await MeshoptDecoder.ready;
const doc = await io.readBinary(new Uint8Array(readFileSync(filename)));
const rig = loadRig(), catalog = loadCatalog(), failures: string[] = [];
const turnLimit = Number(process.env.CAT_MAX_TURN_DEG ?? 90);
const results = [];
for (const animation of doc.getRoot().listAnimations()) {
  const contract = catalog.clips.find(c => c.name === animation.getName());
  if (!contract) throw new Error(`uncatalogued clip ${animation.getName()}`);
  const extras = animation.getExtras();
  for (const key of ['durationS', 'loop', 'layer', 'events', 'contacts', 'authoredSpeed', 'rootMotion'] as const) {
    if (JSON.stringify(extras[key]) !== JSON.stringify(contract[key])) failures.push(`${contract.name}: extras.${key} differs from catalog`);
  }
  let worst = { degreesPerFrame: 0, bone: '', t: 0 }, quaternionError = 0;
  let maxAngularAccelerationDegreesPerFrame2 = 0;
  const angularSteps = new Map<string, number[]>();
  const tracks = animation.listChannels().map(channel => {
    const sampler = channel.getSampler()!;
    return { name: channel.getTargetNode()!.getName(), path: channel.getTargetPath(), times: sampler.getInput()!.getArray()!, values: sampler.getOutput()!.getArray()! };
  });
  const at = (track: typeof tracks[number], t: number) => {
    const { times, values, path } = track;
    let j = 0;
    while (j < times.length - 2 && times[j + 1]! < t) j++;
    const s = Math.min(1, Math.max(0, (t - times[j]!) / (times[j + 1]! - times[j]!)));
    return path === 'rotation'
      ? new Quaternion().fromArray(values, j * 4).slerp(new Quaternion().fromArray(values, (j + 1) * 4), s)
      : new Vector3().fromArray(values, j * 3).lerp(new Vector3().fromArray(values, (j + 1) * 3), s);
  };
  const count = Math.round(contract.durationS * 30);
  const frames = Array.from({ length: count + 1 }, (_, f) => {
    const p = restPose(rig);
    for (const track of tracks) {
      const i = rig.index(track.name), v = at(track, f / 30);
      if (v instanceof Quaternion) {
        quaternionError = Math.max(quaternionError, Math.abs(v.length() - 1)); p.q[i] = v;
      } else if (i === 0) p.root.copy(v);
      else if (i === rig.index('pelvis')) p.pelvis.copy(v);
      else p.t.set(i, v);
    }
    return p;
  });
  frames.forEach((p, f) => { if (f) for (const track of tracks.filter(t => t.path === 'rotation')) {
    const i = rig.index(track.name), degreesPerFrame = frames[f - 1]!.q[i]!.angleTo(p.q[i]!) * 180 / Math.PI;
    const steps = angularSteps.get(track.name) ?? [];
    if (steps.length) maxAngularAccelerationDegreesPerFrame2 = Math.max(maxAngularAccelerationDegreesPerFrame2, Math.abs(degreesPerFrame - steps.at(-1)!));
    steps.push(degreesPerFrame); angularSteps.set(track.name, steps);
    if (degreesPerFrame > worst.degreesPerFrame) worst = { degreesPerFrame, bone: track.name, t: f / 30 };
  } });
  const peakIndex = Math.round(worst.t * 30) - 1;
  const peakFrameAngles = angularSteps.get(worst.bone)?.slice(Math.max(0, peakIndex - 2), peakIndex + 3) ?? [];
  if (!Number.isFinite(worst.degreesPerFrame) || worst.degreesPerFrame > turnLimit) failures.push(`${contract.name}: ${worst.bone} turns ${worst.degreesPerFrame.toFixed(2)}° in one frame at ${worst.t}s`);
  if (quaternionError > 1e-4) failures.push(`${contract.name}: non-unit exported quaternion (${quaternionError})`);
  const worlds = frames.map(p => fk(rig, p)), stance = extras.stance as Partial<Record<typeof LEGS[number], [number, number][]>> | undefined;
  let maxPlantedSlipM = 0;
  const speed = typeof extras.rigSpeed === 'number' ? extras.rigSpeed : 0;
  const distance = (t0: number, t: number) => extras.speedProfile === 'linear 0 to walk speed' ? 2 * speed * (t * t - t0 * t0)
    : extras.speedProfile === 'linear walk speed to 0' ? 2 * speed * (t - t0 - t * t + t0 * t0) : speed * (t - t0);
  for (const id of LEGS) for (const [a, b] of stance?.[id] ?? []) {
    const f0 = Math.ceil(a * 30 - 1e-6), f1 = Math.floor(b * 30 + 1e-6), toe = rig.legs[id].toe;
    const world = (f: number) => worlds[contract.loop ? f % count : Math.min(count, f)]!;
    const start = world(f0).pos[toe]!;
    for (let f = f0; f <= f1; f++) maxPlantedSlipM = Math.max(maxPlantedSlipM, world(f).pos[toe]!.distanceTo(start.clone().add(new Vector3(0, 0, -distance(f0 / 30, f / 30)))));
  }
  if (maxPlantedSlipM > 0.0025) failures.push(`${contract.name}: compressed stance slip ${(maxPlantedSlipM * 1000).toFixed(2)} mm`);
  results.push({ clip: contract.name, ...worst, peakFrameAngles, maxAngularAccelerationDegreesPerFrame2, quaternionError, maxPlantedSlipM });
}
return { clips: results.length, turnLimitDegreesPerFrame: turnLimit, failures, results: results.sort((a, b) => b.degreesPerFrame - a.degreesPerFrame) };
}

if (process.argv[1]?.endsWith('inspect-export.ts')) {
  const report = await inspectExport(process.argv[2]);
  console.log(JSON.stringify(report, null, 2));
  if (report.failures.length) process.exitCode = 1;
}
