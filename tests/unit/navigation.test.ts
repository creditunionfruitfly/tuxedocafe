import { expect,it } from 'vitest';
import { route,walkable } from '../../src/scenes/navigation.ts';
import { Player } from '../../src/scenes/player.ts';
it('routes around a table instead of stopping or cutting through it',()=>{const player=new Player();player.x=-2;player.z=1;const path=route(player,{x:-2,z:-2});expect(path.length).toBeGreaterThan(1);player.walkTo(-2,-2);for(let i=0;i<300;i++){player.step(1/30,0,0);expect(walkable(player.x,player.z)).toBe(true);}expect(player.x).toBeCloseTo(-2,1);expect(player.z).toBeCloseTo(-2,1);});
it('jump-to validates furniture, bounds and distance, and resets velocity and interpolation',()=>{const player=new Player();player.vx=1;expect(player.jumpTo(-2,-.6)).toBe(false);expect(player.jumpTo(5,2)).toBe(false);expect(player.jumpTo(0,-4)).toBe(false);expect(player.jumpTo(1.4,.5)).toBe(true);expect(player.x).toBe(player.previousX);expect(player.z).toBe(player.previousZ);expect(player.vx).toBe(0);expect(player.target).toBeNull();});
it.each([[-2.95,-.6],[-1.05,-.6],[-.45,-3.1],[1.45,-3.1],[2,-4.45],[-4.65,-3.25],[-4.4,1.4],[4.4,1.5]])('never jumps or walks into the authored furniture at %s,%s',(x,z)=>{
 const player=new Player();player.x=x;player.z=z+1;expect(walkable(x,z)).toBe(false);expect(player.jumpTo(x,z)).toBe(false);expect(route(player,{x,z})).toEqual([]);
});
it('keeps the bowl, tap and return approaches connected around the added furniture',()=>{
 const player=new Player();player.x=1.4;player.z=.5;player.walkTo(-1.2,-2.25);for(let i=0;i<420;i++)player.step(1/30,0,0);expect(Math.hypot(player.x+1.2,player.z+2.25)).toBeLessThan(.12);
 player.walkTo(1.4,.5);for(let i=0;i<420;i++)player.step(1/30,0,0);expect(Math.hypot(player.x-1.4,player.z-.5)).toBeLessThan(.12);
});
