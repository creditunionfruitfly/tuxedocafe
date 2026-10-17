import { Bone, Mesh, SkinnedMesh, Texture, type Group } from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import skeleton from '../../art/rig/skeleton.json' with { type: 'json' };
import { CATALOG } from '../anim/catalog.ts';
import { restPoseOfScene, type CatTemplate } from './cat-assets.ts';
import { createCatKit, type CatKit } from './cat-kit.ts';

const names = (skeleton as { bones: { name: string; parent: string | null }[] }).bones;
const targets = CATALOG.morphTargets;

function selfContainedGlb(bytes: ArrayBuffer, label: string): void {
  const header = new DataView(bytes);
  if (bytes.byteLength < 20 || header.getUint32(0, true) !== 0x46546c67 || header.getUint32(8, true) !== bytes.byteLength || header.getUint32(16, true) !== 0x4e4f534a)
    throw new Error(`${label}: invalid binary glTF`);
  const length = header.getUint32(12, true);
  if (length > bytes.byteLength - 20) throw new Error(`${label}: invalid glTF JSON chunk`);
  const json: unknown = JSON.parse(new TextDecoder().decode(new Uint8Array(bytes, 20, length)));
  const resourceLists = json && typeof json === 'object' ? json as { buffers?: { uri?: string }[]; images?: { uri?: string }[] } : {};
  if ([...(resourceLists.buffers ?? []), ...(resourceLists.images ?? [])].some(resource => resource.uri && !resource.uri.startsWith('data:')))
    throw new Error(`${label}: external resources are not supported; export a self-contained GLB`);
}

/** Reject mismatched rigs before they can replace the working kit. */
function validateRig(scene: Group, label: string): void {
  let count = 0;
  scene.traverse(node => {
    if (!(node instanceof SkinnedMesh)) return;
    count++;
    const bones = node.skeleton.bones;
    if (bones.length !== names.length || bones.some((bone, index) => bone.name !== names[index]!.name ||
      (bone.parent instanceof Bone ? bone.parent.name : null) !== names[index]!.parent))
      throw new Error(`${label}: expected the shared 65-bone rig in skeleton.json order`);
    if (node.name === 'cat_body' && targets.some(target => node.morphTargetDictionary?.[target] === undefined))
      throw new Error(`${label}: cat_body is missing catalog morph targets`);
  });
  if (!count) throw new Error(`${label}: no skinned cat mesh found`);
}

function slot(file: File, gltf: GLTF): number | 'anims' {
  if (gltf.animations.length && !gltf.scene.getObjectByName('cat_body')) return 'anims';
  const match = /^cat_master_lod([012])\.glb$/i.exec(file.name);
  if (!match) throw new Error(`${file.name}: name a mesh cat_master_lod0.glb, cat_master_lod1.glb or cat_master_lod2.glb`);
  return Number(match[1]);
}

/** Load a set of user files as one transaction. The caller owns and disposes the returned kit. */
export async function importCatKit(current: CatKit, files: readonly File[], loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)): Promise<CatKit> {
  if (!files.length) throw new Error('Choose a GLB or cat_expressions.json file.');
  const lods = [...current.template.lods], staged: Group[] = [];
  let clips = current.template.clips, clipRest = current.template.clipRest, expressions = current.template.expressions;
  const seen = new Set<string>();
  try {
    for (const file of files) {
      if (/\.json$/i.test(file.name)) {
        if (file.name !== 'cat_expressions.json' || seen.has('expressions')) throw new Error(`${file.name}: expected one cat_expressions.json`);
        const parsed: unknown = JSON.parse(await file.text());
        if (!parsed || typeof parsed !== 'object' || !Array.isArray((parsed as { expressions?: unknown }).expressions)) throw new Error(`${file.name}: missing expressions array`);
        expressions = parsed; seen.add('expressions'); continue;
      }
      if (!/\.glb$/i.test(file.name)) throw new Error(`${file.name}: choose a .glb or cat_expressions.json file`);
      const bytes = await file.arrayBuffer(); selfContainedGlb(bytes, file.name);
      const gltf = await loader.parseAsync(bytes, '');
      const destination = slot(file, gltf), key = String(destination);
      if (seen.has(key)) { staged.push(gltf.scene); throw new Error(`${file.name}: duplicate ${destination} in this selection`); }
      seen.add(key);
      if (destination === 'anims') {
        const rest = restPoseOfScene(gltf.scene);
        // Some authored animation GLBs carry tracks only; their rest pose comes
        // from the same shared mesh skeleton (as in the production asset).
        if (rest.size && (rest.size !== names.length || names.some(bone => !rest.has(bone.name)))) throw new Error(`${file.name}: expected the shared 65-bone animation rig`);
        const available = new Set(gltf.animations.map(clip => clip.name));
        const missing = CATALOG.clips.filter(clip => !available.has(clip.name));
        if (missing.length) throw new Error(`${file.name}: missing ${missing.length} catalog clips (first: ${missing[0]!.name})`);
        const known = new Set(names.map(bone => bone.name));
        if (!gltf.animations.some(clip => clip.tracks.length) || gltf.animations.some(clip => clip.tracks.some(track => !known.has(track.name.slice(0, track.name.lastIndexOf('.'))))))
          throw new Error(`${file.name}: animation tracks must target the shared cat rig`);
        clips = gltf.animations; clipRest = rest.size ? rest : null;
      } else {
        staged.push(gltf.scene); validateRig(gltf.scene, file.name); lods[destination] = gltf.scene;
      }
    }
    const template: CatTemplate = { plan: { ...current.template.plan, source: 'master' }, lods, clips, clipRest, expressions };
    const kit = createCatKit(template);
    // A malformed glTF that parsed yet cannot instantiate must not be committed.
    return kit;
  } catch (error) {
    for (const scene of staged) scene.traverse(node => {
      if (!(node instanceof Mesh)) return;
      node.geometry.dispose();
      for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
        for (const value of Object.values(material)) if (value instanceof Texture) value.dispose();
        material.dispose();
      }
    });
    throw error;
  }
}
