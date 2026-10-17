/* global document, window, location, getComputedStyle */
// Review page for the master cat: renders a grid of named views of one GLB under neutral studio
// light. Driven by tools/art/review-cat.ts; window.__done flips true once every view is drawn.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

const q = new URLSearchParams(location.search);
const src = q.get('src'), mode = q.get('mode') ?? 'shaded', pose = q.get('pose') ?? '', morphs = q.get('morphs') ?? '';
const views = (q.get('views') ?? 'front,threequarter,side,back,top').split(',');
const cols = Number(q.get('cols') ?? Math.min(views.length, 3)), w = Number(q.get('w') ?? 520), h = Number(q.get('h') ?? 400);
const rows = Math.ceil(views.length / cols);
const background = q.get('bg') ?? '#cfd8d3';

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(cols * w, rows * h);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(background);
scene.add(new THREE.HemisphereLight(0xf4f1ea, 0x6d6255, 1.25));
const key = new THREE.DirectionalLight(0xfff1e0, 2.4);
key.position.set(.9, 1.5, 1.1); key.castShadow = true;
key.shadow.mapSize.set(2048, 2048); key.shadow.camera.left = -.6; key.shadow.camera.right = .6; key.shadow.camera.top = .6; key.shadow.camera.bottom = -.6; key.shadow.bias = -.0006; key.shadow.normalBias = .004;
scene.add(key);
const rim = new THREE.DirectionalLight(0xd6e6ff, 1.1); rim.position.set(-1.2, .8, -1.4); scene.add(rim);
const fill = new THREE.DirectionalLight(0xffffff, .45); fill.position.set(-1, .3, 1); scene.add(fill);
const floor = new THREE.Mesh(new THREE.PlaneGeometry(4, 4), new THREE.MeshStandardMaterial({ color: '#b9c7bf', roughness: .95 }));
floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
if (q.get('floor') === '0') floor.visible = false;

const PALETTE = [0xe6194b, 0x3cb44b, 0xffe119, 0x4363d8, 0xf58231, 0x911eb4, 0x46f0f0, 0xf032e6, 0xbcf60c, 0xfabebe, 0x008080, 0xe6beff,
  0x9a6324, 0xfffac8, 0x800000, 0xaaffc3, 0x808000, 0xffd8b1, 0x000075, 0x808080, 0x1f77b4, 0xff7f0e, 0x2ca02c, 0xd62728, 0x9467bd,
  0x8c564b, 0xe377c2, 0x7f7f7f, 0xbcbd22, 0x17becf];

function checkerTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 1024;
  const g = c.getContext('2d');
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) { g.fillStyle = (x + y) % 2 ? '#f2efe6' : '#3f4a52'; g.fillRect(x * 32, y * 32, 32, 32); }
  g.strokeStyle = '#d2463c'; g.lineWidth = 3; for (let i = 0; i <= 8; i++) { g.beginPath(); g.moveTo(i * 128, 0); g.lineTo(i * 128, 1024); g.stroke(); g.beginPath(); g.moveTo(0, i * 128); g.lineTo(1024, i * 128); g.stroke(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}

function applyMode(root) {
  const focus = q.get('bone');
  const meshes = [];
  root.traverse(o => { if (o.isMesh) meshes.push(o); });
  meshes.forEach(o => {
    o.castShadow = q.get('shadows') !== '0'; o.receiveShadow = q.get('shadows') !== '0';
    const g = o.geometry;
    if (mode === 'weights' && g.attributes.skinIndex) {
      const si = g.attributes.skinIndex, sw = g.attributes.skinWeight, n = si.count, col = new Float32Array(n * 3), c = new THREE.Color();
      const bones = o.skeleton.bones.map(b => b.name), focusIndex = focus ? bones.indexOf(focus) : -1;
      for (let i = 0; i < n; i++) {
        let r = 0, gg = 0, b = 0;
        for (let k = 0; k < 4; k++) {
          const j = si.getComponent(i, k), wt = sw.getComponent(i, k);
          if (focusIndex >= 0) { if (j === focusIndex) { r += wt; } continue; }
          c.setHex(PALETTE[(j * 7) % PALETTE.length]); r += c.r * wt; gg += c.g * wt; b += c.b * wt;
        }
        if (focusIndex >= 0) { c.setHSL(.66 * (1 - r), 1, .5); col.set([c.r, c.g, c.b], i * 3); } else col.set([r, gg, b], i * 3);
      }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      o.material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .8, transparent: o.material.transparent, opacity: o.material.opacity });
    } else if (mode === 'uv' && g.attributes.uv) {
      o.material = new THREE.MeshStandardMaterial({ map: checkerTexture(), roughness: .85, transparent: o.material.transparent, opacity: o.material.opacity });
    } else if (mode === 'flow' && g.attributes._furflow) {
      const f = g.attributes._furflow, n = f.count, col = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) col.set([f.getX(i) * .5 + .5, f.getY(i) * .5 + .5, f.getZ(i) * .5 + .5], i * 3);
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      o.material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .8 });
    } else if (mode === 'length' && g.attributes._furlength) {
      const f = g.attributes._furlength, n = f.count, col = new Float32Array(n * 3), c = new THREE.Color();
      for (let i = 0; i < n; i++) { c.setHSL(.7 * (1 - f.getX(i)), .9, .5); col.set([c.r, c.g, c.b], i * 3); }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      o.material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .8 });
    } else if (mode === 'wire') {
      o.material = new THREE.MeshStandardMaterial({ color: o.material.color ?? 0xcccccc, roughness: .8, transparent: o.material.transparent, opacity: o.material.opacity });
      const wire = new THREE.Mesh(o.geometry, new THREE.MeshBasicMaterial({ color: 0x1b2420, wireframe: true, transparent: true, opacity: .35 }));
      if (o.isSkinnedMesh) { const s = new THREE.SkinnedMesh(o.geometry, wire.material); s.bind(o.skeleton, o.bindMatrix); o.add(s); } else o.add(wire);
    } else if (mode === 'clay') {
      o.material = new THREE.MeshStandardMaterial({ color: o.material.transparent ? 0xffffff : 0xb9b2a6, roughness: o.material.transparent ? .05 : .62, transparent: o.material.transparent, opacity: o.material.transparent ? .25 : 1 });
    }
  });
}

function applyPose(root) {
  const bones = new Map();
  root.traverse(o => { if (o.isBone) bones.set(o.name, o); });
  for (const item of pose.split(';').filter(Boolean)) {
    const [name, x, y, z] = item.split(':');
    const bone = bones.get(name);
    if (!bone) { console.warn('no bone', name); continue; }
    bone.rotation.x += Number(x || 0) * Math.PI / 180; bone.rotation.y += Number(y || 0) * Math.PI / 180; bone.rotation.z += Number(z || 0) * Math.PI / 180;
  }
  for (const item of morphs.split(';').filter(Boolean)) {
    const [name, value] = item.split(':');
    root.traverse(o => { if (o.morphTargetDictionary && name in o.morphTargetDictionary) o.morphTargetInfluences[o.morphTargetDictionary[name]] = Number(value); });
  }
}

// Views: camera direction from target, target, distance, fov.
const VIEWS = {
  front: { dir: [0, .12, 1], target: [0, .2, 0], dist: 1.05, fov: 30 },
  threequarter: { dir: [.75, .38, .85], target: [0, .19, -.03], dist: 1.25, fov: 30 },
  side: { dir: [1, .05, 0], target: [0, .19, -.06], dist: 1.35, fov: 30 },
  back: { dir: [-.15, .2, -1], target: [0, .19, 0], dist: 1.15, fov: 30 },
  top: { dir: [0, 1, -.001], target: [0, .2, -.06], dist: 1.3, fov: 34 },
  threequarterBack: { dir: [-.8, .35, -.8], target: [0, .19, -.05], dist: 1.25, fov: 30 },
  sideRight: { dir: [-1, .05, 0], target: [0, .19, -.06], dist: 1.35, fov: 30 },
  under: { dir: [.2, -1, .15], target: [0, .1, -.05], dist: 1.1, fov: 34 },
  face: { dir: [0, .06, 1], target: [0, .292, .27], dist: .24, fov: 30 },
  faceThreeQuarter: { dir: [.7, .12, .8], target: [0, .292, .265], dist: .24, fov: 30 },
  faceSide: { dir: [1, .05, .05], target: [0, .29, .255], dist: .26, fov: 30 },
  eyeClose: { dir: [.25, .05, 1], target: [.019, .296, .27], dist: .085, fov: 30 },
  mouth: { dir: [.25, -.12, 1], target: [0, .262, .285], dist: .14, fov: 30 },
  mouthSide: { dir: [.8, -.1, .6], target: [0, .262, .28], dist: .15, fov: 30 },
  paws: { dir: [.45, .25, 1], target: [0, .03, .11], dist: .33, fov: 30 },
  pawsHind: { dir: [.6, .3, -1], target: [0, .04, -.15], dist: .33, fov: 30 },
  pawSole: { dir: [.1, -1, .25], target: [.033, .01, .135], dist: .16, fov: 30 },
  pawFront: { dir: [.35, .25, 1], target: [.033, .02, .135], dist: .14, fov: 30 },
  ears: { dir: [.3, .5, 1], target: [0, .33, .23], dist: .22, fov: 30 },
  earBack: { dir: [.4, .4, -1], target: [0, .33, .22], dist: .22, fov: 30 },
  custom: { dir: (q.get('cdir') ?? '0,0,1').split(',').map(Number), target: (q.get('ctarget') ?? '0,.2,0').split(',').map(Number), dist: Number(q.get('cdist') ?? .3), fov: 30 },
};

const labels = document.getElementById('labels');
new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).load(src, gltf => {
  const root = gltf.scene;
  scene.add(root);
  applyPose(root);
  applyMode(root);
  root.updateMatrixWorld(true);
  const camera = new THREE.PerspectiveCamera(30, w / h, .005, 20);
  renderer.setScissorTest(true);
  views.forEach((name, i) => {
    const v = VIEWS[name] ?? VIEWS.front;
    const col = i % cols, row = Math.floor(i / cols);
    const dir = new THREE.Vector3(...v.dir).normalize(), target = new THREE.Vector3(...v.target);
    camera.fov = v.fov; camera.aspect = w / h; camera.position.copy(target).addScaledVector(dir, v.dist); camera.up.set(0, 1, 0);
    if (Math.abs(dir.y) > .99) camera.up.set(0, 0, -1);
    camera.lookAt(target); camera.updateProjectionMatrix();
    const y = (rows - 1 - row) * h;
    renderer.setViewport(col * w, y, w, h); renderer.setScissor(col * w, y, w, h);
    renderer.render(scene, camera);
    const label = document.createElement('span'); label.textContent = name; label.style.left = `${col * w + 6}px`; label.style.top = `${row * h + 6}px`; labels.appendChild(label);
  });
  const info = { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, bg: getComputedStyle(document.body).background };
  window.__info = info;
  window.__done = true;
}, undefined, e => { window.__error = String(e); window.__done = true; });
