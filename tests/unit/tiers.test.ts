import { expect, it } from 'vitest';
import { chooseTier, parseTier, TierBenchmark } from '../../src/core/tiers.ts';
import { mayReload } from '../../src/core/update-check.ts';
it('chooses a tier against memory, cores and measured frame budget', () => {
 const probe = { mobile: false, memory: 8, cores: 8, samples: 4 };
 expect(chooseTier(probe,16)).toBe('high'); expect(chooseTier({...probe,mobile:true},16)).toBe('phone'); expect(chooseTier({...probe,memory:2},16)).toBe('low'); expect(chooseTier(probe,28)).toBe('low'); expect(chooseTier(probe,20)).toBe('low'); expect(parseTier('bogus')).toBeNull();
 const benchmark = new TierBenchmark(); let result = null; for(let t=1;t<2100;t+=16) result = benchmark.update(t); expect(result).toBe(16);
});
it('allows asset recovery once for a build', () => { expect(mayReload('a','a')).toBe(false); expect(mayReload('a','b')).toBe(true); });
