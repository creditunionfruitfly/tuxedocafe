import { expect, it } from 'vitest';
import { Gestures } from '../../src/input/gestures.ts';
it.each([['object','hold'],['cat','stroke'],['floor','radial'],['none','radial']] as const)('recognizes %s drags', (target,state) => { const g=new Gestures(); g.press(target); expect(g.move(10)).toBe(state); g.release(); expect(g.state).toBe('hover'); });
it('recognizes floor taps, right drag, two-finger walk, dwell and toggle', () => {
 const g=new Gestures();g.press('floor');expect(g.release()).toBe('walk');expect(g.press('floor',true)).toBe('look');g.release();g.press('floor');expect(g.move(2,2)).toBe('move');expect(g.move(40,1)).toBe('move');expect(g.release()).toBe('hover');expect(g.press('floor',false,2)).toBe('move');g.release();g.press('floor');g.reset();g.target='object';expect(g.tick(.25)).toBe('menu');g.reset();g.toggle=true;expect(g.press('object')).toBe('hold');expect(g.release()).toBe('hold');expect(g.press('object')).toBe('hover');
});
it('uses a displacement dead zone before a drag becomes radial look',()=>{const g=new Gestures();g.press('floor');for(let i=0;i<30;i++)expect(g.move(2)).toBe('hover');expect(g.move(9)).toBe('radial');expect(g.release()).toBe('hover');});
