import { expect,it } from 'vitest';
import { Ray,Vector3 } from 'three';
import { makeProxy,raycastProxies } from '../../src/interaction/proxies.ts';
import { HoldDrag } from '../../src/interaction/hold-drag.ts';
import { TapFill } from '../../src/interaction/tap-fill.ts';
it('hits region boxes before the floor and can exclude a carried object',()=>{const target=makeProxy('bowl',[0,.2,0],[1,.4,1],['Fill']);const ray=new Ray(new Vector3(0,2,0),new Vector3(0,-1,0));expect(raycastProxies(ray,[target])?.region).toBe('bowl');expect(raycastProxies(ray,[target],'bowl')?.region).toBe('floor');expect(raycastProxies(new Ray(new Vector3(10,2,0),new Vector3(0,-1,0)),[target])).toBeNull();});
it('rejects invalid carry placement and completes only after filling and returning',()=>{const hold=new HoldDrag();expect(hold.start('water-bowl')).toBe(true);hold.move(-2,1,-3.5);expect(hold.release('wall')).toBe(false);expect(hold.position).toEqual(hold.origin);const fill=new TapFill();expect(fill.returnToStation(1.4,-.7)).toBe(false);for(let i=0;i<89;i++)fill.step(1/30,true);expect(fill.filled).toBe(false);fill.step(1/30,true);expect(fill.filled).toBe(true);expect(fill.returnToStation(-2,-3.5)).toBe(false);expect(fill.returnToStation(1.4,-.7)).toBe(true);expect(fill.returnToStation(1.4,-.7)).toBe(false);});
