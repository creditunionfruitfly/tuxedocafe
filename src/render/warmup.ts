/** Wait for submitted startup work without blocking the browser's UI thread. */
export function waitForGpu(gl: WebGL2RenderingContext): Promise<void> {
  return new Promise((resolve, reject) => {
    const fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    if (!fence) { reject(new Error('Unable to prepare the café GPU context.')); return; }
    gl.flush();
    const poll = (): void => {
      const state = gl.clientWaitSync(fence, 0, 0);
      if (state === gl.TIMEOUT_EXPIRED) { requestAnimationFrame(poll); return; }
      gl.deleteSync(fence);
      if (state === gl.WAIT_FAILED) reject(new Error('The café GPU context was lost during startup.'));
      else resolve();
    };
    requestAnimationFrame(poll);
  });
}
