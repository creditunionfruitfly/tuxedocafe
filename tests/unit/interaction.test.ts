import { expect,it } from 'vitest';
import { Ray,Vector3 } from 'three';
import { makeProxy,raycastProxies } from '../../src/interaction/proxies.ts';
import { HoldDrag } from '../../src/interaction/hold-drag.ts';
import { TapFill } from '../../src/interaction/tap-fill.ts';
it('hits region boxes before the floor and can exclude a carried object',()=>{const target=makeProxy('bowl',[0,.2,0],[1,.4,1],['Fill']);const ray=new Ray(new Vector3(0,2,0),new Vector3(0,-1,0));expect(raycastProxies(ray,[target])?.region).toBe('bowl');expect(raycastProxies(ray,[target],'bowl')?.region).toBe('floor');expect(raycastProxies(new Ray(new Vector3(10,2,0),new Vector3(0,-1,0)),[target])).toBeNull();});
it('rejects invalid carry placement and completes only after filling and returning',()=>{const hold=new HoldDrag();expect(hold.start('water-bowl')).toBe(true);hold.move(-2,1,-3.5);expect(hold.release('wall')).toBe(false);expect(hold.position).toEqual(hold.origin);const fill=new TapFill();expect(fill.returnToStation(1.4,-.7)).toBe(false);for(let i=0;i<89;i++)fill.step(1/30,true);expect(fill.filled).toBe(false);expect(fill.step(1/30,true)).toBe(1);expect(fill.filled).toBe(true);expect(fill.returnToStation(-2,-3.5)).toBe(false);expect(fill.returnToStation(1.4,-.7)).toBe(true);expect(fill.returnToStation(1.4,-.7)).toBe(false);});
it('picks each prop up where it was placed, accepts tables, and returns invalid drops to the pickup position',()=>{
 const carry=new HoldDrag();carry.start('water-bowl');carry.move(2,.85,-1);expect(carry.release('floor',2,-1)).toBe(true);carry.start('water-bowl');expect(carry.position).toEqual({x:2,y:.08,z:-1});carry.move(-2,.85,-.6);expect(carry.release('table-1',-2,-.6,.83)).toBe(true);carry.start('water-bowl');carry.move(8,2,8);expect(carry.release('wall')).toBe(false);expect(carry.position).toEqual({x:-2,y:.83,z:-.6});carry.start('food-bowl');expect(carry.position).toEqual({x:1.9,y:.08,z:-.7});
});
