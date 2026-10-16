import { expect,it } from 'vitest';
import { DoubleTap } from '../../src/input/double-tap.ts';
it('pairs nearby taps within simulation time once, then resets',()=>{const taps=new DoubleTap();expect(taps.tap(100,100)).toBe(false);taps.step(.3);expect(taps.tap(120,110)).toBe(true);expect(taps.tap(120,110)).toBe(false);});
it('rejects long gaps, distant taps and cancelled gestures',()=>{const taps=new DoubleTap();taps.tap(0,0);taps.step(.33);expect(taps.tap(0,0)).toBe(false);expect(taps.tap(40,0)).toBe(false);taps.reset();expect(taps.tap(40,0)).toBe(false);});

it('recognizes native input timestamps when rendering delays delivery',()=>{const taps=new DoubleTap();expect(taps.tap(0,0,12)).toBe(false);taps.step(.8);expect(taps.tap(0,0,12.12)).toBe(true);taps.reset();taps.tap(0,0,15);expect(taps.tap(0,0,14)).toBe(false);});
