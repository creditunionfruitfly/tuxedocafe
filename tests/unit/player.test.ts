import { expect, it } from 'vitest';
import { Player } from '../../src/scenes/player.ts';
import { slide } from '../../src/scenes/collision.ts';
import { FixedLoop } from '../../src/core/loop.ts';
it('moves at a fixed speed independently of rendering', () => {
  const results = [30,144].map(fps => { const player = new Player(); const loop = new FixedLoop(dt => player.step(dt,0,1), () => {}); for(let i=0;i<=fps;i++)loop.frame(i*1000/fps); return player.z; });
  expect(results[0]).toBeCloseTo(results[1]!,10); expect(results[0]).toBeLessThan(1.1);
});
it('slides against furniture and clamps room boundaries', () => {
  const p = { x: 0, z: 0 }; slide(p,.3,.3,[{minX:.4,maxX:1,minZ:-1,maxZ:1}]); expect(p.x).toBe(0); expect(p.z).toBe(.3);
  slide(p,100,100,[]); expect(p.x).toBe(4.77); expect(p.z).toBe(2.77);
});
it('arrives at walk targets and limits pitch', () => { const player = new Player(); player.walkTo(0,1); for(let i=0;i<180;i++)player.step(1/30,0,0); expect(player.z).toBeCloseTo(1,1); expect(player.target).toBeNull(); player.look(0,99999); expect(player.pitch).toBe(-1.396); });
