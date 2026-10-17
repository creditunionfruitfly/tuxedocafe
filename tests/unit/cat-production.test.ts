import { beforeAll, describe, expect, it } from 'vitest';
import { SkinnedMesh, Texture, Vector3 } from 'three';
import { readFileSync } from 'node:fs';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { CATALOG } from '../../src/anim/catalog.ts';
import { createResidentCat } from '../../src/cats/cat-instance.ts';
import { RESIDENTS } from '../../src/cats/builds.ts';
import { importCatKit } from '../../src/cats/import-kit.ts';
import { disposeCatKit } from '../../src/cats/load-kit.ts';
import type { CatKit } from '../../src/cats/cat-kit.ts';
import { EventBus } from '../../src/core/events.ts';
import { FixedLoop } from '../../src/core/loop.ts';
import { createRng } from '../../src/core/rng.ts';
import { hasProductionCat, productionKit } from './helpers/production-cat.ts';

// Asset-independent tests cover fallback scaffolding; this suite requires npm run assets.
describe.skipIf(!hasProductionCat())('authored master cat runtime', () => {
  let kit: CatKit;
  beforeAll(async () => { kit = await productionKit(); });
  it('atomically imports real local GLBs and expressions; invalid files retain the active kit', async () => {
    const files = ['cat_master_lod0.glb', 'cat_master_lod1.glb', 'cat_master_lod2.glb', 'cat_anims.glb', 'cat_expressions.json'].map(name =>
      new File([readFileSync(`public/assets/art/cats/${name}`)], name));
    const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    loader.register(() => ({ name: 'CPU_texture_stub', loadTexture: async () => new Texture() }));
    const replacement = await importCatKit(kit, files, loader);
    expect(replacement.standIns).toEqual([]);
    expect(replacement.template.lods.every(Boolean)).toBe(true);
    const cat = createResidentCat(replacement, RESIDENTS[0]!, { rng: createRng('import') });
    expect(cat.rig.bones).toHaveLength(65);
    expect(cat.animation.animator.preview('cat.loco.walk')).toBe(true);
    cat.dispose();
    await expect(importCatKit(replacement, [new File(['broken'], 'cat_master_lod0.glb')], loader)).rejects.toThrow();
    expect(replacement.template.lods[0]!.children.length).toBeGreaterThan(0);
    const expressions = await importCatKit(replacement, [files[4]!], loader);
    expect(expressions.template.lods[0]).toBe(replacement.template.lods[0]);
    disposeCatKit(replacement, expressions); disposeCatKit(expressions, kit);
  });
  it('binds every real clip, all resident builds and all LODs without shared mutable skeletons', () => {
    expect(kit.standIns).toEqual([]);
    const cats = RESIDENTS.map(data => createResidentCat(kit, data, { rng: createRng(data.id) }));
    const vertex = new Vector3();
    for (const cat of cats) {
      expect(cat.levels.every(level => level.length > 0)).toBe(true);
      expect(cat.rig.names).toEqual(cats[0]!.rig.names);
      for (const [level, meshes] of cat.levels.entries()) {
        const triangles = meshes.reduce((total, mesh) => total + (mesh.geometry.index?.count ?? mesh.geometry.getAttribute('position').count) / 3, 0);
        expect(triangles, `${cat.id}:LOD${level} triangle budget`).toBeLessThanOrEqual([30000, 12000, 4000][level]!);
        const bodies = meshes.filter(mesh => mesh.geometry.morphAttributes.position?.length);
        expect(bodies.length, `${cat.id}:LOD${level} expression meshes`).toBeGreaterThan(0);
        for (const mesh of bodies) expect(Object.keys(mesh.morphTargetDictionary ?? {}), `${cat.id}:LOD${level}:${mesh.name} morph names`).toEqual(CATALOG.morphTargets);
      }
      const blink = kit.expressions.byName.get('blink')!;
      cat.animation.expressions.play('blink'); cat.animation.expressions.advance(blink.durationS * .4); cat.animation.tick(0); cat.animation.render(1);
      const index = CATALOG.morphTargets.indexOf('blink_L'); expect(cat.animation.morphWeights[index]).toBeGreaterThan(.5);
      for (const meshes of cat.levels) for (const mesh of meshes) if (mesh.morphTargetDictionary?.blink_L !== undefined) {
        expect(mesh.morphTargetInfluences![mesh.morphTargetDictionary.blink_L], `${cat.id}:${mesh.name} blink weight`).toBe(cat.animation.morphWeights[index]);
      }
      for (const spec of CATALOG.clips) {
        expect(cat.animation.animator.preview(spec.name)).toBe(true);
        for (const fraction of [0, .25, .5, .75, 1]) {
          cat.animation.seekPreview(spec.durationS * fraction);
          expect(cat.animation.pose.data.every(Number.isFinite), `${cat.id}:${spec.name}@${fraction}`).toBe(true);
          cat.root.updateMatrixWorld(true);
          for (const meshes of cat.levels) for (const mesh of meshes) {
            if (mesh instanceof SkinnedMesh) mesh.skeleton.update();
            const count = mesh.geometry.getAttribute('position').count;
            for (const index of [0, Math.floor(count / 3), Math.floor(count * 2 / 3), count - 1]) {
              mesh.getVertexPosition(index, vertex);
              expect(vertex.toArray().every(Number.isFinite), `${cat.id}:${spec.name}:${mesh.name} deformed vertex`).toBe(true);
              expect(vertex.length(), `${cat.id}:${spec.name}:${mesh.name} deformation bound`).toBeLessThan(10);
            }
          }
        }
      }
    }
    expect(cats[0]!.skeleton).not.toBe(cats[1]!.skeleton);
    expect(cats[0]!.materials[0]).not.toBe(cats[1]!.materials[0]);
    for (const cat of cats) cat.dispose();
  });
  it.each(RESIDENTS)('replays $id actions, layers, look, IK, blinks and events identically at 30/60/144 fps', resident => {
    const replay = (fps: number) => {
      const bus = new EventBus(), events: string[] = [], poses: number[][] = [];
      bus.on('cat:anim-event', event => events.push(`${event.clip}:${event.name}`));
      const cat = createResidentCat(kit, resident, { rng: createRng('production-replay'), bus });
      const hand = new Vector3(.15, .4, .5); let tick = 0;
      const loop = new FixedLoop(dt => {
        if (tick === 40) cat.animation.animator.play('cat.react.hiss', 0);
        if (tick === 75) { cat.animation.animator.stopAction(); cat.animation.animator.setLayer('cat.layer.tail_up', 1); }
        cat.animation.drive(tick < 40 ? .58 : 0, 0, dt); cat.animation.lookAt(hand, .7); cat.animation.tick(dt);
        poses.push(Array.from(cat.animation.pose.data)); tick++;
      }, alpha => cat.animation.render(alpha));
      for (let frame = 0; frame <= fps * 4; frame++) loop.frame(frame * 1000 / fps);
      cat.dispose(); return { poses, events };
    };
    const reference = replay(30); expect(reference.events).toContain('cat.react.hiss:sfx:cat.warn.hiss');
    expect(replay(60)).toEqual(reference); expect(replay(144)).toEqual(reference);
  });
});
