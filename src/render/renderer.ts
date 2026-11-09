import { NeutralToneMapping, PCFSoftShadowMap, WebGLRenderer } from 'three';
import { createSceneOutput } from './scene-output.ts';
import { TIER_CONFIG, parseTier, needsTierReload, type Tier } from '../core/tiers.ts';
export function createRenderer(canvas: HTMLCanvasElement) {
  const initial = parseTier(new URLSearchParams(location.search).get('tier'));
  const mobile = initial === 'phone' || initial === 'low' || (!initial && matchMedia('(pointer: coarse)').matches);
  const renderer = new WebGLRenderer({ canvas, antialias: false, depth: false, powerPreference: 'high-performance' });
  renderer.toneMapping = NeutralToneMapping; renderer.shadowMap.type = PCFSoftShadowMap;
  const output = createSceneOutput(renderer);
  let tier: Tier = initial ?? (mobile ? 'phone' : 'desktop'); let scale = TIER_CONFIG[tier].max as number; let average = 16.7; let frames = 0;
  const resize = (): void => {
    const max = TIER_CONFIG[tier].max;
    output.resize(Math.max(1, canvas.clientWidth), Math.max(1, canvas.clientHeight),
      Math.min(devicePixelRatio, mobile ? 1.5 : 2) * max, scale / max);
  };
  const configure = (value: Tier): boolean => {
    if (needsTierReload(!mobile, value)) {
      const url = new URL(location.href); url.searchParams.set('tier', value); location.replace(url.href); return false;
    }
    tier = value;
    const config = TIER_CONFIG[tier];
    scale = config.max; renderer.shadowMap.enabled = config.shadows;
    output.configure(config.aa, config.optics);
    document.body.dataset.tier = tier; resize();
    return true;
  };
  window.addEventListener('resize', resize); configure(tier);
  return { renderer, configure, resize, compileAsync: output.compileAsync, render: output.render, adapt(milliseconds: number) {
    average += (milliseconds - average) * .03;
    if (++frames % 90 !== 0) return;
    const config = TIER_CONFIG[tier]; const previous = scale;
    if (average > 1000 / config.target * 1.15) scale = Math.max(config.min, scale - .05);
    else if (average < 1000 / config.target * .92) scale = Math.min(config.max, scale + .025);
    if (previous !== scale) resize();
  }, dispose() { window.removeEventListener('resize', resize); output.dispose(); renderer.dispose(); } };
}
