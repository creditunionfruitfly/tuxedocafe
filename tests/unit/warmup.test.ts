import { afterEach, expect, it, vi } from 'vitest';
import { waitForGpu } from '../../src/render/warmup.ts';
afterEach(() => vi.unstubAllGlobals());
function gpu(states: number[]): { gl: WebGL2RenderingContext; next(): void; deleted: ReturnType<typeof vi.fn> } {
  let frame: FrameRequestCallback;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frame = callback; });
  const deleted = vi.fn();
  const gl = { SYNC_GPU_COMMANDS_COMPLETE: 1, TIMEOUT_EXPIRED: 2, WAIT_FAILED: 3,
    fenceSync: () => ({}), flush: vi.fn(), deleteSync: deleted,
    clientWaitSync: () => states.shift() } as unknown as WebGL2RenderingContext;
  return { gl, next: () => frame(0), deleted };
}
it('keeps startup pending until submitted GPU work completes', async () => {
  const device = gpu([2, 4]); let ready = false;
  const warmup = waitForGpu(device.gl).then(() => { ready = true; });
  device.next(); await Promise.resolve(); expect(ready).toBe(false); expect(device.deleted).not.toHaveBeenCalled();
  device.next(); await warmup; expect(ready).toBe(true); expect(device.deleted).toHaveBeenCalledOnce();
});
it('rejects a lost GPU context and releases its startup fence', async () => {
  const device = gpu([3]); const warmup = waitForGpu(device.gl);
  device.next(); await expect(warmup).rejects.toThrow('context was lost'); expect(device.deleted).toHaveBeenCalledOnce();
});
