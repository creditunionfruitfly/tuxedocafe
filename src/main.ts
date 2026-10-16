import buildInfo from 'virtual:build-info';
import { siteUrl } from './core/assets.ts';
import { formatStamp, isNewerBuild, parseBuildInfo } from './core/build-info.ts';
import { mountPlaceholderCafe } from './scenes/placeholder-cafe.ts';

// Baseline boot (task M0-1). Task M0-2 replaces this with the engine skeleton:
// tier probe, fixed-step loop, event bus, flags, channel storage, landscape guard.

const body = document.body;

const stamp = document.querySelector<HTMLElement>('#build-stamp');
if (stamp) stamp.textContent = formatStamp(buildInfo);

function supportsWebGL2(): boolean {
  try {
    return document.createElement('canvas').getContext('webgl2') !== null;
  } catch {
    return false;
  }
}

const canvas = document.querySelector<HTMLCanvasElement>('#view');
if (canvas && supportsWebGL2()) {
  mountPlaceholderCafe(canvas, () => {
    body.dataset.ready = 'true';
  });
} else {
  document.querySelector<HTMLElement>('#unsupported')?.removeAttribute('hidden');
  body.dataset.ready = 'unsupported';
}

/** Proves version.json resolves under the base path; M0-2 grows this into the update notice. */
async function checkLiveBuild(): Promise<void> {
  try {
    const response = await fetch(siteUrl('version.json'), { cache: 'no-store' });
    const live = parseBuildInfo(await response.json());
    if (live === null) body.dataset.liveVersion = 'invalid';
    else body.dataset.liveVersion = isNewerBuild(buildInfo, live) ? 'newer' : 'ok';
  } catch {
    body.dataset.liveVersion = 'unreachable';
  }
}
void checkLiveBuild();
