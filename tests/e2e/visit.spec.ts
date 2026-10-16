import { expect,test,type Page,type TestInfo } from '@playwright/test';
import { PerspectiveCamera,Vector3 } from 'three';
import { STARTUP_TIMEOUT } from './config.ts';
test.use({actionTimeout:10_000});
async function enter(page:Page,info?:TestInfo):Promise<void>{
 await page.goto('./?tier=low');await expect(page.locator('body')).toHaveAttribute('data-ready','true',{timeout:STARTUP_TIMEOUT});await page.locator('#start').click();await page.locator('#patron-name').fill('River');if(info)await page.screenshot({path:info.outputPath('patron-creation.png')});await page.getByRole('button',{name:'Make yourself at home'}).click();await expect(page.locator('body')).toHaveAttribute('data-phase','play');await expect(page.locator('body')).toHaveAttribute('data-player',/\d/);
}
async function screenPoint(page:Page,x:number,y:number,z:number):Promise<{x:number;y:number}>{
 const size=page.viewportSize()!,position=(await page.locator('body').getAttribute('data-player'))!.split(',').map(Number),look=(await page.locator('body').getAttribute('data-look'))!.split(',').map(Number);
 const camera=new PerspectiveCamera(61,size.width/size.height,.04,60);camera.position.set(position[0]!,1.6,position[1]!);camera.rotation.set(look[1]!,look[0]!,0,'YXZ');camera.position.add(new Vector3(0,0,-look[2]!).applyEuler(camera.rotation));camera.updateMatrixWorld();const point=new Vector3(x,y,z).project(camera);return{x:(point.x+1)*size.width/2,y:(1-point.y)*size.height/2};
}
async function lookAt(page:Page,isMobile:boolean,x:number,y:number,z:number):Promise<void>{
 const position=(await page.locator('body').getAttribute('data-player'))!.split(',').map(Number),look=(await page.locator('body').getAttribute('data-look'))!.split(',').map(Number);
 const yaw=Math.atan2(position[0]!-x,position[1]!-z),pitch=Math.atan2(y-1.6,Math.hypot(position[0]!-x,position[1]!-z));let dx=-(yaw-look[0]!)/.003,dy=-(pitch-look[1]!)/.003;
 const size=page.viewportSize()!,start={x:size.width*.65,y:size.height*.45},session=isMobile?await page.context().newCDPSession(page):null;
 while(Math.abs(dx)>.5||Math.abs(dy)>.5){const mx=Math.max(-160,Math.min(160,dx)),my=Math.max(-100,Math.min(100,dy));
  if(session){await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[start,{x:start.x+60,y:start.y}]});await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:start.x+mx,y:start.y+my},{x:start.x+60+mx,y:start.y+my}]});await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});}
  else{await page.mouse.move(start.x,start.y);await page.mouse.down({button:'right'});await page.mouse.move(start.x+mx,start.y+my);await page.mouse.up({button:'right'});}dx-=mx;dy-=my;
 }
 await session?.detach();
 // Let camera interpolation and the public render stamp settle after the UI gesture.
 await expect.poll(async()=>Number((await page.locator('body').getAttribute('data-look'))!.split(',')[1])).toBeCloseTo(pitch,1);
}
async function tapPoint(page:Page,isMobile:boolean,x:number,y:number,z:number):Promise<void>{await lookAt(page,isMobile,x,y,z);const point=await screenPoint(page,x,y,z);if(isMobile)await page.touchscreen.tap(point.x,point.y);else await page.mouse.click(point.x,point.y);}
async function jump(page:Page,isMobile:boolean,x:number,z:number):Promise<void>{
 await lookAt(page,isMobile,x,0,z);const point=await screenPoint(page,x,0,z);if(isMobile){const session=await page.context().newCDPSession(page);const timestamp=Date.now()/1000-.2;for(const [type,offset] of [['touchStart',0],['touchEnd',.04],['touchStart',.12],['touchEnd',.16]] as const)await session.send('Input.dispatchTouchEvent',{type,touchPoints:type==='touchEnd'?[]:[point],timestamp:timestamp+offset});await session.detach();}else await page.mouse.dblclick(point.x,point.y,{delay:60});
 await expect.poll(async()=>{const p=(await page.locator('body').getAttribute('data-player'))!.split(',').map(Number);return Math.hypot(p[0]!-x,p[1]!-z);}).toBeLessThan(.12);
}
test('first visit, accessibility and profile survive a reload',async({page},info)=>{
 await enter(page,info);await page.locator('.top-settings').click();await page.locator('input[name="leftHanded"]').check();await page.locator('input[name="holdToggle"]').check();await page.locator('input[name="reducedMotion"]').check();await page.locator('#close-settings').click();await expect(page.locator('body')).toHaveClass(/left-handed/);await page.reload();await expect(page.locator('#start')).toHaveText('Continue your visit');await expect(page.locator('#returning')).toContainText('River');await page.locator('#start').click();await page.screenshot({path:info.outputPath('first-visit.png')});
});
test('walk, proxy hover action and room collision stay playable',async({page,isMobile},info)=>{
 await enter(page);await expect(page.locator('body')).toHaveAttribute('data-player',/\d/);const before=await page.locator('body').getAttribute('data-player');
 if(!isMobile){await page.bringToFront();await page.keyboard.down('w');await expect(page.locator('body')).not.toHaveAttribute('data-player',before!);await page.keyboard.up('w');}
 else {await lookAt(page,isMobile,0,0,-1.4);const floor=await screenPoint(page,0,0,-1.4),session=await page.context().newCDPSession(page);await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[floor]});await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:floor.x+15,y:floor.y+15}]});await expect(page.locator('body')).not.toHaveAttribute('data-player',before!);await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await session.detach();}
 const lookBefore=await page.locator('body').getAttribute('data-look');
 if(!isMobile){await page.mouse.move(600,300);await page.mouse.down({button:'right'});await page.mouse.move(660,320);await page.mouse.up({button:'right'});await page.mouse.wheel(0,-60);}
 else{const cdp=await page.context().newCDPSession(page);await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:400,y:150},{x:460,y:150}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:430,y:170},{x:510,y:170}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});}
 await expect(page.locator('body')).not.toHaveAttribute('data-look',lookBefore!);
 await page.screenshot({path:info.outputPath('cafe-play.png')});
 await info.attach('render-metrics',{body:JSON.stringify(await page.locator('body').evaluate(body=>({tier:body.dataset.tier,drawCalls:body.dataset.drawCalls,triangles:body.dataset.triangles,softwareFrameMs:body.dataset.frameMs}))),contentType:'application/json'});
 expect(Number(await page.locator('body').getAttribute('data-draw-calls'))).toBeLessThanOrEqual(80);
});
test('water chore requires approaching, carrying to the tap, filling and returning',async({page,isMobile},info)=>{
 test.slow(); // Live phone-landscape runs take ~1.6 min, past the 90 s default (pages run 38954271674).
 await enter(page);await tapPoint(page,isMobile,1.4,.13,-.7);await expect(page.locator('#hover-menu')).toBeHidden();await expect(page.locator('#notice')).toContainText('Move closer');await expect(page.locator('body')).toHaveAttribute('data-carry','');
 await jump(page,isMobile,1.4,.5);await tapPoint(page,isMobile,1.4,.13,-.7);await page.getByRole('button',{name:'1 Pick up',exact:true}).click();await expect(page.locator('body')).toHaveAttribute('data-carry','water-bowl');
 await jump(page,isMobile,2.4,-.5);await tapPoint(page,isMobile,-2,1.2,-3.55);await expect(page.locator('#hover-menu')).toBeHidden();await expect(page.locator('#water-progress')).toBeHidden();
 await jump(page,isMobile,-1.2,-2.25);await expect(page.locator('body')).toHaveAttribute('data-carry','water-bowl');await tapPoint(page,isMobile,-2,1.2,-3.55);await page.getByRole('button',{name:'1 Fill',exact:true}).click();
 await expect(page.locator('#task-copy')).toContainText('Bring the bowl back',{timeout:15000});await jump(page,isMobile,1.4,.5);await tapPoint(page,isMobile,1.4,0,-.7);await page.getByRole('button',{name:'1 Place',exact:true}).click();
 await expect(page.locator('#chore-card')).toHaveClass(/complete/);await expect(page.locator('body')).toHaveAttribute('data-carry','');await page.screenshot({path:info.outputPath('water-complete.png')});
});
test('portrait pauses behind the landscape guide',async({page})=>{await page.goto('./?tier=low');await page.setViewportSize({width:390,height:844});await expect(page.locator('#rotate')).toBeVisible();await page.setViewportSize({width:844,height:390});await expect(page.locator('#rotate')).toBeHidden();});

test('placed props can be picked up again and carry survives settings without remote drops',async({page,isMobile})=>{
 await enter(page);await jump(page,isMobile,1.4,.5);await tapPoint(page,isMobile,1.4,.13,-.7);await page.getByRole('button',{name:'1 Pick up',exact:true}).click();await expect(page.locator('body')).toHaveAttribute('data-carry','water-bowl');
 await tapPoint(page,isMobile,2.4,0,-.4);await page.getByRole('button',{name:'1 Place',exact:true}).click();await expect(page.locator('body')).toHaveAttribute('data-carry','');
 await tapPoint(page,isMobile,2.4,.13,-.4);await page.getByRole('button',{name:'1 Pick up',exact:true}).click();await expect(page.locator('body')).toHaveAttribute('data-carry','water-bowl');
 await page.locator('.top-settings').click();await page.locator('#close-settings').click();await expect(page.locator('body')).toHaveAttribute('data-carry','water-bowl');
 await tapPoint(page,isMobile,0,0,-4.5);await expect(page.locator('#hover-menu')).toBeHidden();await expect(page.locator('body')).toHaveAttribute('data-carry','water-bowl');
 await tapPoint(page,isMobile,2.4,0,-.4);await page.getByRole('button',{name:'1 Place',exact:true}).click();await expect(page.locator('body')).toHaveAttribute('data-carry','');
});
test('lookdev loads the actual 65-bone capsule rig',async({page,isMobile},info)=>{await page.goto(`./?lookdev=cat&tier=${isMobile?'low':'desktop'}`);await expect(page.locator('body')).toHaveAttribute('data-ready','true',{timeout:STARTUP_TIMEOUT});await expect(page.locator('body')).toHaveAttribute('data-bones','65');await expect(page.locator('#lookdev-status')).toContainText('capsule rig diagnostic');await page.screenshot({path:info.outputPath('capsule-lookdev.png')});});
test('Settings About shows the build and feedback opens a metadata-prefilled draft',async({page})=>{
 await page.goto('./?tier=low');await expect(page.locator('body')).toHaveAttribute('data-ready','true',{timeout:STARTUP_TIMEOUT});await page.locator('.top-settings').click();
 const stamp=await page.locator('#build-stamp').textContent();await expect(page.locator('#about-build')).toContainText(stamp!);await expect(page.locator('#about-flags')).toContainText('Enabled flags:');
 await page.locator('#feedback').evaluate(link=>link.addEventListener('click',event=>event.preventDefault(),{once:true}));await page.locator('#feedback').click();
 const draft=new URL((await page.locator('#feedback').getAttribute('href'))!);expect(draft.searchParams.get('template')).toBe('playtest.yml');expect(draft.searchParams.get('build')).toContain(stamp!.split(' · ')[0]!);expect(draft.searchParams.get('channel')).toBe(stamp!.split(' · ')[1]);expect(draft.searchParams.get('tier')).toBe('low');expect(draft.searchParams.get('browser')).toMatch(/Mozilla/);expect(draft.searchParams.get('device')).toContain('viewport');
});
test('automatic tier boot settles before a patron can begin a draft',async({page})=>{
 await page.goto('./');await expect(page.locator('#start')).toBeEnabled({timeout:STARTUP_TIMEOUT});await expect(page.locator('#start')).toHaveAttribute('aria-busy','false');await expect(page.locator('body')).toHaveAttribute('data-ready','true');await expect(page.locator('body')).toHaveAttribute('data-gpu-ready','true');
 await page.locator('#start').click();await page.locator('#patron-name').fill('Avery');const settledURL=page.url();
 // The benchmark resolves after two seconds; a draft must survive beyond that boundary.
 await page.waitForTimeout(2300);expect(page.url()).toBe(settledURL);await expect(page.locator('body')).toHaveAttribute('data-phase','create');await expect(page.locator('#patron-name')).toHaveValue('Avery');
});
