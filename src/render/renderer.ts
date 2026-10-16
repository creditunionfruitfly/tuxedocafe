import { NeutralToneMapping, PCFSoftShadowMap, WebGLRenderer } from 'three';
import { TIER_CONFIG, parseTier, needsTierReload, type Tier } from '../core/tiers.ts';
export function createRenderer(canvas: HTMLCanvasElement): { renderer: WebGLRenderer; configure(tier: Tier): void; resize(): void; adapt(milliseconds: number): void; dispose(): void } {
  const initial = parseTier(new URLSearchParams(location.search).get('tier'));
  const mobile = initial === 'phone' || initial === 'low' || (!initial && matchMedia('(pointer: coarse)').matches);
  const renderer = new WebGLRenderer({ canvas, antialias: !mobile, powerPreference: 'high-performance' });
  renderer.toneMapping = NeutralToneMapping; renderer.shadowMap.type = PCFSoftShadowMap;
  let tier: Tier = mobile ? 'phone' : 'desktop'; let scale = TIER_CONFIG[tier].max as number; let average = 16.7; let frames = 0;
  const resize = (): void => {
    renderer.setPixelRatio(Math.min(devicePixelRatio, mobile ? 1.5 : 2) * scale);
    renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
  };
  const configure = (value: Tier): void => { if(needsTierReload(!mobile,value)){const url=new URL(location.href);url.searchParams.set('tier',value);location.replace(url.href);return;} tier = value; scale = TIER_CONFIG[tier].max; renderer.shadowMap.enabled = TIER_CONFIG[tier].shadows; document.body.dataset.tier = tier; resize(); };
  window.addEventListener('resize', resize); configure(tier);
  return { renderer, configure, resize, adapt(milliseconds) {
    average += (milliseconds - average) * .03;
    if (++frames % 90 !== 0) return;
    const config = TIER_CONFIG[tier]; const previous = scale;
    if (average > 1000 / config.target * 1.15) scale = Math.max(config.min, scale - .05);
    else if (average < 1000 / config.target * .92) scale = Math.min(config.max, scale + .025);
    if (previous !== scale) resize();
  }, dispose() { window.removeEventListener('resize', resize); renderer.dispose(); } };
}
