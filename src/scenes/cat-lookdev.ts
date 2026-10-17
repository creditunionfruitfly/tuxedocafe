import { BoxGeometry, Color, DirectionalLight, GridHelper, HemisphereLight, Mesh, MeshStandardMaterial, PerspectiveCamera, PlaneGeometry, Scene, SkeletonHelper, Vector3, type Texture } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { flatGround, withSlope, withStep } from '../anim/ground.ts';
import { RESIDENTS } from '../cats/builds.ts';
import { createResidentCat, type ResidentCat } from '../cats/cat-instance.ts';
import { loadCatKit, disposeCatKit } from '../cats/load-kit.ts';
import { importCatKit } from '../cats/import-kit.ts';
import { CatSurfaces } from '../cats/surfaces.ts';
import { siteUrl } from '../core/assets.ts';
import { EventBus } from '../core/events.ts';
import { FixedLoop } from '../core/loop.ts';
import { createRng } from '../core/rng.ts';
import { parseTier } from '../core/tiers.ts';
import { createRenderer } from '../render/renderer.ts';
import './cat-lookdev.css';

interface SurfaceState { material: MeshStandardMaterial; color: Color; map: Texture | null; normal: Texture | null; roughness: Texture | null }

/** Actual shared rig, authored clips, expressions and the same IK runtime used in the café. */
export async function mountCatLookdev(): Promise<void> {
  const body = document.body, canvas = document.querySelector<HTMLCanvasElement>('#view')!;
  for (const element of Array.from(body.children)) if (element instanceof HTMLElement && element !== canvas) element.hidden = true;
  body.dataset.phase = 'lookdev';
  const root = document.createElement('main'); root.id = 'cat-viewer';
  root.innerHTML = `<header><h1>Tuxedo Cafe <span>· Cat studio</span></h1><small>Original resident cats / shared rig / authored motion</small><a href="${siteUrl('')}">Back to café ↗</a></header>
  <aside><h2>Residents</h2><label>Cat<select id="cat-resident" aria-label="Resident cat"></select></label><p id="cat-description"></p>
  <h2>Inspect</h2><label>Detail<select id="cat-lod" aria-label="Cat LOD"></select></label>
  <label><input id="cat-skeleton" type="checkbox">Skeleton</label><label><input id="cat-wireframe" type="checkbox">Wireframe</label>
  <label><input id="cat-ik" type="checkbox" checked>Ground IK</label><label><input id="cat-look" type="checkbox">Look at camera</label><label><input id="cat-clay" type="checkbox">Clay surface</label>
  <label>Support<select id="cat-ground"><option value="flat">Studio floor</option><option value="step">6 cm step</option><option value="slope">10° slope</option></select></label>
  <h2>Local asset update</h2><label class="cat-import">Choose GLBs / expressions JSON<input id="cat-files" type="file" multiple accept=".glb,.json"></label><p>Drop updated master LOD GLBs, cat_anims.glb, or cat_expressions.json here. Files stay on this device.</p><div id="cat-import-status" role="status" aria-live="polite"></div>
  <h2>Expressions</h2><div class="cat-expression"><button data-expression="blink">Blink</button><button data-expression="slow_blink">Slow blink</button><button data-expression="snarl">Snarl</button></div>
  <p>Drag to orbit · scroll / pinch to zoom. Clips play on the resident’s own build. Sound markers remain silent until the behavior phase.</p><div id="cat-events" aria-live="polite"></div></aside>
  <div class="cat-stage"><div id="lookdev-status" class="cat-hud">Loading cat assets…</div><div class="cat-transport"><button id="cat-play">Pause</button><input id="cat-time" type="range" min="0" max="1" step="0.001" value="0" aria-label="Animation time"><output id="cat-clock">0.00 / 0.00 s</output></div></div>
  <aside><h2>Animation library <span id="cat-clip-count"></span></h2><input id="cat-filter" type="search" placeholder="Filter clips…" aria-label="Filter clips"><p id="cat-clip-notes"></p><div id="cat-clips"></div></aside>`;
  body.append(root); root.querySelector('.cat-stage')!.prepend(canvas); canvas.setAttribute('aria-label', 'Resident cat inspection viewport. Drag to orbit and scroll to zoom.');
  const $ = <T extends HTMLElement>(selector: string): T => root.querySelector<T>(selector)!;
  const display = createRenderer(canvas), tier = parseTier(new URLSearchParams(location.search).get('tier')) ?? 'desktop'; display.configure(tier);
  const scene = new Scene(); scene.background = new Color('#cbd7d9');
  const camera = new PerspectiveCamera(37, 1, .01, 50); camera.position.set(.85, .55, 1.05);
  scene.add(new HemisphereLight(0xf7fdff, 0x676357, 2.1));
  const key = new DirectionalLight(0xffefd7, 3); key.position.set(2, 3, 2); scene.add(key);
  const rim = new DirectionalLight(0xc1e7ff, 2); rim.position.set(-2, 1, -2); scene.add(rim);
  const floor = new Mesh(new PlaneGeometry(8, 8), new MeshStandardMaterial({ color: '#b8c8c8', roughness: .9 })); floor.rotation.x = -Math.PI / 2; floor.position.y = -.003; scene.add(floor);
  const grid = new GridHelper(4, 40, 0xa0b6b7, 0xb2c4c5); grid.position.y = -.002; scene.add(grid);
  const support = new Mesh(new BoxGeometry(1.2, .06, 1), new MeshStandardMaterial({ color: '#9bb7ac', roughness: .9 })); support.visible = false; scene.add(support);
  const controls = new OrbitControls(camera, canvas); controls.target.set(0, .19, 0); controls.minDistance = .45; controls.maxDistance = 3; controls.update();
  const bus = new EventBus(); let kit = await loadCatKit(tier); const surfaces = new CatSurfaces();
  const resident = $<HTMLSelectElement>('#cat-resident'), lod = $<HTMLSelectElement>('#cat-lod'), clips = $('#cat-clips'), slider = $<HTMLInputElement>('#cat-time'), play = $<HTMLButtonElement>('#cat-play');
  for (const data of RESIDENTS) resident.add(new Option(data.name, data.id));
  for (let i = 0; i < kit.template.lods.length; i++) if (kit.template.lods[i]) lod.add(new Option(`LOD ${i}${i === 0 ? ' · full' : i === 1 ? ' · medium' : ' · distant'}`, String(i)));
  const clipButtons = new Map<string, HTMLButtonElement>();
  for (const spec of kit.catalog.clips) {
    const button = document.createElement('button'); button.textContent = spec.name.replace('cat.', ''); button.dataset.clip = spec.name;
    const tag = document.createElement('small'); tag.textContent = `${spec.durationS.toFixed(1)}s`; button.append(tag); clips.append(button); clipButtons.set(spec.name, button);
    button.onclick = () => selectClip(spec.name);
  }
  $('#cat-clip-count').textContent = `(${kit.catalog.clips.length})`;
  let cat: ResidentCat, skeleton: SkeletonHelper, releaseTextures: (() => void) | null = null, state: SurfaceState[] = [], paused = false, selected = 'cat.loco.idle', switching = 0, cpuMs = 0, samples = 0;
  const eventLog: string[] = [], point = new Vector3();
  bus.on('cat:anim-event', event => { eventLog.unshift(event.name); eventLog.length = Math.min(3, eventLog.length); $('#cat-events').textContent = eventLog.join(' · '); });
  const setPaused = (value: boolean): void => { paused = value; play.textContent = value ? 'Play' : 'Pause'; play.setAttribute('aria-pressed', String(value)); };
  function selectClip(name: string): void {
    selected = name; cat.animation.animator.preview(name); cat.animation.seekPreview(0); slider.max = String(cat.animation.animator.tracks.get(name)!.duration);
    for (const [id, button] of clipButtons) button.setAttribute('aria-pressed', String(id === name));
    const spec = kit.catalog.byName.get(name)!; $('#cat-clip-notes').textContent = `${spec.layer} · ${spec.loop ? 'loops' : 'one shot'}${spec.rootMotion ? ' · root motion' : ''}`;
    body.dataset.clip = name; setPaused(false);
  }
  function applySurface(): void {
    const clay = $<HTMLInputElement>('#cat-clay').checked, wireframe = $<HTMLInputElement>('#cat-wireframe').checked;
    for (const item of state) {
      item.material.color.copy(clay ? new Color('#c5b4a3') : item.color); item.material.map = clay ? null : item.map; item.material.normalMap = clay ? null : item.normal; item.material.roughnessMap = clay ? null : item.roughness;
      item.material.wireframe = wireframe; item.material.needsUpdate = true;
    }
  }
  function ground(): void {
    const value = $<HTMLSelectElement>('#cat-ground').value;
    cat.animation.ground = value === 'step' ? withStep(flatGround(), { minX: -1, maxX: 1, minZ: .05, maxZ: 1 }, .06)
      : value === 'slope' ? withSlope(flatGround(), { minX: -2, maxX: 2, minZ: -2, maxZ: 2 }, 0, 0, 0, 10, 0) : flatGround();
    support.visible = value !== 'flat'; support.position.set(0, value === 'step' ? .03 : -.03, value === 'step' ? .55 : 0); support.rotation.x = value === 'slope' ? Math.PI / 18 : 0;
    cat.animation.legs.reset();
    if (cat.animation.animator.previewClip) cat.animation.seekPreview(cat.animation.animator.previewTime);
  }
  async function chooseResident(nextKit: typeof kit = kit): Promise<boolean> {
    const token = ++switching, data = RESIDENTS.find(data => data.id === resident.value)!;
    const next = createResidentCat(nextKit, data, { bus, rng: createRng(`lookdev:${data.id}`) });
    let release: () => void;
    try { release = await surfaces.bind(next, tier); } catch (error) { next.dispose(); throw error; }
    if (token !== switching) { release(); next.dispose(); return false; }
    const previous = cat, previousSkeleton = skeleton, previousRelease = releaseTextures;
    kit = nextKit; cat = next; releaseTextures = release; scene.add(cat.root);
    skeleton = new SkeletonHelper(cat.root); skeleton.visible = $<HTMLInputElement>('#cat-skeleton').checked; scene.add(skeleton);
    cat.animation.place(0, 0, 0, 0); cat.setLevel(Number(lod.value)); ground(); selectClip(selected);
    cat.animation.legs.weight = $<HTMLInputElement>('#cat-ik').checked ? 1 : 0;
    $('#cat-description').textContent = `${data.model.build} build · ${(cat.build.scale * 100).toFixed(0)}% scale`;
    body.dataset.bones = String(cat.rig.bones.length); body.dataset.catSource = kit.template.plan.source; body.dataset.resident = data.id; body.dataset.standIns = String(kit.standIns.length);
    state = next.materials.filter((material): material is MeshStandardMaterial => material instanceof MeshStandardMaterial).map(material => ({ material, color: material.color.clone(), map: material.map, normal: material.normalMap, roughness: material.roughnessMap })); applySurface(); body.dataset.surfaceResident = data.id;
    previousRelease?.(); previous?.dispose(); if (previousSkeleton) { previousSkeleton.removeFromParent(); previousSkeleton.dispose(); }
    return true;
  }
  await chooseResident();
  resident.onchange = () => { void chooseResident().catch(() => { $('#cat-events').textContent = 'A surface did not finish loading. Choose the cat again to retry.'; }); }; lod.onchange = () => cat.setLevel(Number(lod.value));
  $<HTMLInputElement>('#cat-skeleton').onchange = event => { skeleton.visible = (event.target as HTMLInputElement).checked; };
  $<HTMLInputElement>('#cat-ik').onchange = event => { cat.animation.legs.weight = (event.target as HTMLInputElement).checked ? 1 : 0; cat.animation.seekPreview(cat.animation.animator.previewTime); };
  for (const id of ['#cat-wireframe', '#cat-clay']) $<HTMLInputElement>(id).onchange = applySurface;
  $<HTMLSelectElement>('#cat-ground').onchange = ground;
  $<HTMLInputElement>('#cat-filter').oninput = event => { const filter = (event.target as HTMLInputElement).value.toLowerCase(); for (const [name, button] of clipButtons) button.hidden = !name.includes(filter); };
  for (const button of root.querySelectorAll<HTMLButtonElement>('[data-expression]')) button.onclick = () => cat.animation.expressions.play(button.dataset.expression!);
  const input = $<HTMLInputElement>('#cat-files'), importStatus = $('#cat-import-status');
  async function importFiles(files: readonly File[]): Promise<void> {
    if (!files.length || body.dataset.importStatus === 'loading') return;
    input.disabled = true; body.dataset.importStatus = 'loading'; importStatus.textContent = `Checking ${files.length} local file${files.length === 1 ? '' : 's'}…`;
    let next: typeof kit | null = null;
    try {
      next = await importCatKit(kit, files);
      const old = kit;
      if (await chooseResident(next)) {
        disposeCatKit(old, next);
        lod.replaceChildren();
        next.template.lods.forEach((scene, level) => { if (scene) lod.add(new Option(`LOD ${level}${level === 0 ? ' · full' : level === 1 ? ' · medium' : ' · distant'}`, String(level))); });
        lod.value = String(cat.level);
        importStatus.textContent = `Loaded ${files.map(file => file.name).join(', ')} · ${next.standIns.length} stand-ins`;
        body.dataset.importStatus = 'loaded';
      } else { disposeCatKit(next, kit); importStatus.textContent = 'The selection changed while files loaded. Choose the files again.'; body.dataset.importStatus = 'error'; }
    } catch (error) {
      if (next && next !== kit) disposeCatKit(next, kit);
      importStatus.textContent = `Could not load: ${error instanceof Error ? error.message : String(error)}`;
      body.dataset.importStatus = 'error';
    } finally { input.disabled = false; input.value = ''; }
  }
  input.onchange = () => { void importFiles(Array.from(input.files ?? [])); };
  root.ondragover = event => { if (event.dataTransfer?.types.includes('Files')) event.preventDefault(); };
  root.ondrop = event => { event.preventDefault(); void importFiles(Array.from(event.dataTransfer?.files ?? [])); };
  play.onclick = () => setPaused(!paused); slider.oninput = () => { setPaused(true); cat.animation.seekPreview(Number(slider.value)); };
  const loop = new FixedLoop(dt => {
    if (paused) return;
    camera.getWorldPosition(point); cat.animation.lookAt($<HTMLInputElement>('#cat-look').checked ? point : null);
    const start = performance.now(); cat.animation.tick(dt); const ms = performance.now() - start; if (++samples > 30) cpuMs += (ms - cpuMs) / Math.min(300, samples - 30);
  }, alpha => {
    cat.animation.render(paused ? 1 : alpha); camera.aspect = canvas.clientWidth / Math.max(1, canvas.clientHeight); camera.updateProjectionMatrix(); display.renderer.render(scene, camera);
    const time = cat.animation.animator.previewTime; slider.value = String(time); $('#cat-clock').textContent = `${time.toFixed(2)} / ${Number(slider.max).toFixed(2)} s`;
    $('#lookdev-status').textContent = `${cat.data.name} · ${tier} · LOD ${cat.level}\n${cat.triangles.toLocaleString()} triangles · ${display.renderer.info.render.calls} draws\n65 bones · ${kit.catalog.clips.length} clips · ${kit.standIns.length} stand-ins\n30 Hz simulation · ${cpuMs.toFixed(2)} ms/cat CPU`;
    body.dataset.ready = 'true'; body.dataset.drawCalls = String(display.renderer.info.render.calls); body.dataset.triangles = String(display.renderer.info.render.triangles); body.dataset.animationTime = time.toFixed(4); body.dataset.animationCpuMs = cpuMs.toFixed(4);
  });
  display.resize(); display.renderer.setAnimationLoop(time => loop.frame(time));
  window.addEventListener('pagehide', event => { if (event.persisted) return; switching++; display.renderer.setAnimationLoop(null); releaseTextures?.(); cat.dispose(); skeleton.dispose(); disposeCatKit(kit); controls.dispose(); grid.dispose(); support.geometry.dispose(); support.material.dispose(); floor.geometry.dispose(); floor.material.dispose(); display.dispose(); });
}
