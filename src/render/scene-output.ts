import {
  BufferGeometry, Camera, DepthTexture, Float32BufferAttribute, HalfFloatType, LinearSRGBColorSpace,
  Mesh, Scene, ShaderMaterial, UnsignedByteType, UnsignedIntType, Vector2, WebGLRenderTarget,
  type PerspectiveCamera, type WebGLRenderer,
} from 'three';
import { outputFragment, outputVertex } from './shaders/scene-output.ts';

export function planAntialiasing(requested: number, color: ArrayLike<number>, depth: ArrayLike<number>, limit: number) {
  const availableDepth = Array.from(depth);
  const native = Array.from(color).reduce((best, n) =>
    n > 1 && n <= requested && n <= limit && availableDepth.includes(n) ? Math.max(best, n) : best, 0);
  const ratio = Math.sqrt(requested / Math.max(1, native));
  return { native, ratio: ratio > 2 ? 3 : ratio };
}

export function limitOutputPixelRatio(width: number, height: number, requested: number,
  plan: ReturnType<typeof planAntialiasing>, hdr: boolean, desktop: boolean, sizeLimit: number, adaptiveScale = 1): number {
  const budget = (desktop ? 320 : 64) * 1024 ** 2;
  // Count resolved color/depth plus the native color/depth renderbuffers, if any.
  const bytesPerPixel = (hdr ? 12 : 8) * (1 + plan.native);
  const memoryRatio = Math.sqrt(budget / (width * height * bytesPerPixel));
  const roundedRatio = memoryRatio - 1 / Math.min(width, height); // Reserve room for ceil() on both axes.
  return adaptiveScale * Math.min(requested, roundedRatio / plan.ratio, sizeLimit / (Math.max(width, height) * plan.ratio));
}

export function supportsHdrTarget(renderer: WebGLRenderer): boolean {
  return renderer.extensions.has('EXT_color_buffer_float') || renderer.extensions.has('EXT_color_buffer_half_float');
}

export function createSceneOutput(renderer: WebGLRenderer) {
  const gl = renderer.getContext() as WebGL2RenderingContext;
  const hdr = supportsHdrTarget(renderer);
  const samples = (format: number): Int32Array =>
    gl.getInternalformatParameter(gl.RENDERBUFFER, format, gl.SAMPLES) as Int32Array;
  const colorSamples = samples(hdr ? gl.RGBA16F : gl.RGBA8);
  const depthSamples = samples(gl.DEPTH_COMPONENT24);
  const viewportLimit = gl.getParameter(gl.MAX_VIEWPORT_DIMS) as Int32Array;
  const sizeLimit = Math.min(gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) as number,
    renderer.capabilities.maxTextureSize, ...viewportLimit);
  const scene = new Scene(), camera = new Camera(), geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute([-1, 3, 0, -1, -1, 0, 3, -1, 0], 3));
  geometry.setAttribute('uv', new Float32BufferAttribute([0, 2, 0, 0, 2, 0], 2));
  const uniforms = {
    sceneColor: { value: null as WebGLRenderTarget['texture'] | null }, sceneDepth: { value: null as DepthTexture | null },
    sceneSize: { value: new Vector2() }, outputSize: { value: new Vector2() },
    cameraNear: { value: 0 }, cameraFar: { value: 0 }, focusDistance: { value: 2.3 },
  };
  const material = new ShaderMaterial({
    vertexShader: outputVertex, fragmentShader: outputFragment, uniforms,
    depthTest: false, depthWrite: false, toneMapped: hdr,
  });
  const triangle = new Mesh(geometry, material);
  triangle.frustumCulled = false; scene.add(triangle);
  let target: WebGLRenderTarget;
  let requested = 0, plan = { native: 0, ratio: 1 };
  let optics = false;

  function setTarget(): void {
    // Use the explicit color + DEPTH_COMPONENT24 blit for sampled depth. The optional
    // render-to-texture extension is otherwise allowed to manage phone color resolves.
    if (optics && plan.native) {
      (renderer.properties.get(target) as { __useRenderToTexture?: boolean }).__useRenderToTexture = false;
    }
    renderer.setRenderTarget(target);
  }

  function configure(aa: number, desktopOptics: boolean): void {
    if (requested === aa && optics === desktopOptics) return;
    target?.dispose(); requested = aa; optics = desktopOptics;
    plan = planAntialiasing(requested, colorSamples, depthSamples, renderer.capabilities.maxSamples);
    target = new WebGLRenderTarget(1, 1, {
      type: hdr ? HalfFloatType : UnsignedByteType, colorSpace: LinearSRGBColorSpace,
      depthTexture: optics ? new DepthTexture(1, 1, UnsignedIntType) : null,
      samples: plan.native, resolveDepthBuffer: optics, storeMultisampledDepthBuffer: optics,
    });
    // Pinned Three output-mode flag: on byte-only hardware apply Neutral in the
    // scene shaders while writing linear values. The composite then only encodes sRGB.
    if (!hdr) Object.assign(target, { isXRRenderTarget: true });
    uniforms.sceneColor.value = target.texture;
    uniforms.sceneDepth.value = target.depthTexture;
    material.defines = { AA_TAPS: plan.ratio === 1 ? 0 : plan.ratio > 2 ? 4 : 3 };
    if (optics) material.defines.DESKTOP_OPTICS = 1;
    material.needsUpdate = true;
  }

  return {
    configure,
    resize(width: number, height: number, pixelRatio: number, adaptiveScale = 1) {
      renderer.setDrawingBufferSize(width, height,
        limitOutputPixelRatio(width, height, pixelRatio, plan, hdr, optics, sizeLimit, adaptiveScale));
      const output = renderer.getDrawingBufferSize(uniforms.outputSize.value);
      output.set(Math.max(1, output.x), Math.max(1, output.y));
      const ratio = Math.min(plan.ratio, sizeLimit / Math.max(output.x, output.y));
      const targetWidth = Math.min(sizeLimit, Math.ceil(output.x * ratio));
      const targetHeight = Math.min(sizeLimit, Math.ceil(output.y * ratio));
      target.setSize(targetWidth, targetHeight);
      uniforms.sceneSize.value.set(targetWidth, targetHeight);
      const diagnostic = document.body.dataset;
      diagnostic.aaRequested = String(requested);
      diagnostic.aaNative = String(plan.native);
      diagnostic.aaDensity = (targetWidth / output.x * targetHeight / output.y * Math.max(1, plan.native)).toFixed(2);
      diagnostic.aaResolve = ratio < 1 ? 'size-limited' : plan.ratio > 1 ? 'supersample' : 'native';
      diagnostic.optics = optics ? 'depth-and-highlight' : 'off';
    },
    async compileAsync(world: Scene, view: PerspectiveCamera) {
      setTarget();
      const worldPrograms = renderer.compileAsync(world, view);
      renderer.setRenderTarget(null);
      await Promise.all([worldPrograms, renderer.compileAsync(scene, camera)]);
    },
    render(world: Scene, view: PerspectiveCamera, focusDistance = 2.3) {
      setTarget();
      renderer.render(world, view);
      renderer.setRenderTarget(null);
      if (optics) {
        uniforms.cameraNear.value = view.near;
        uniforms.cameraFar.value = view.far;
        uniforms.focusDistance.value = Math.max(0.55, focusDistance);
      }
      // Keep the scene and composite in the same frame's draw/triangle counters.
      renderer.info.autoReset = false;
      renderer.render(scene, camera);
      renderer.info.autoReset = true;
    },
    dispose() { target.dispose(); material.dispose(); geometry.dispose(); },
  };
}
