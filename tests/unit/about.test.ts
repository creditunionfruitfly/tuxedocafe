import { expect,it } from 'vitest';
import { feedbackUrl } from '../../src/ui/about.ts';
it('prefills the playtest issue form using its exact field IDs and escapes metadata',()=>{
 const info={version:'v0.1.0',commit:'abcdef',channel:'m1',builtAt:'2026-10-16T00:00:00Z',flags:[]};
 const url=new URL(feedbackUrl(info,'low','Browser / 1 & 2','Touch; viewport 863×360'));
 expect(url.origin).toBe('https://github.com');expect(url.pathname).toBe('/creditunionfruitfly/tuxedocafe/issues/new');
 expect(Object.fromEntries(url.searchParams)).toEqual({template:'playtest.yml',build:'v0.1.0 (abcdef)',channel:'m1',tier:'low',browser:'Browser / 1 & 2',device:'Touch; viewport 863×360'});
});
