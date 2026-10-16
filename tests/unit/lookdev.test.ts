import { expect,it } from 'vitest';
import { lookdevAsset } from '../../src/scenes/lookdev.ts';
it('only permits explicitly packaged diagnostic assets',()=>{expect(lookdevAsset('cat')).toBe('cat');expect(lookdevAsset('hand')).toBe('hand');expect(lookdevAsset('cafe')).toBe('cafe');expect(lookdevAsset('https://example.com/private.glb')).toBeNull();});
