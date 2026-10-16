import { expect,test,type Page,type TestInfo } from '@playwright/test';
import { PerspectiveCamera,Vector3 } from 'three';
async function enter(page:Page,info?:TestInfo):Promise<void>{
 await page.goto('./?tier=low');await expect(page.locator('body')).toHaveAttribute('data-ready','true');await page.locator('#start').click();await page.locator('#patron-name').fill('River');if(info)await page.screenshot({path:info.outputPath('patron-creation.png')});await page.getByRole('button',{name:'Make yourself at home'}).click();await expect(page.locator('body')).toHaveAttribute('data-phase','play');
}
function screenPoint(page:Page,x:number,y:number,z:number):{x:number;y:number}{
 const size=page.viewportSize()!;const camera=new PerspectiveCamera(61,size.width/size.height,.04,60);camera.position.set(0,1.6,2.2);camera.rotation.set(-.08,0,0,'YXZ');camera.updateMatrixWorld();const point=new Vector3(x,y,z).project(camera);return{x:(point.x+1)*size.width/2,y:(1-point.y)*size.height/2};
}
test('first visit, accessibility and profile survive a reload',async({page},info)=>{
 await enter(page,info);await page.locator('.top-settings').click();await page.locator('input[name="leftHanded"]').check();await page.locator('input[name="holdToggle"]').check();await page.locator('input[name="reducedMotion"]').check();await page.locator('#close-settings').click();await expect(page.locator('body')).toHaveClass(/left-handed/);await page.reload();await expect(page.locator('#start')).toHaveText('Continue your visit');await expect(page.locator('#returning')).toContainText('River');await page.locator('#start').click();await page.screenshot({path:info.outputPath('first-visit.png')});
});
test('walk, proxy hover action and room collision stay playable',async({page,isMobile},info)=>{
 await enter(page);await expect(page.locator('body')).toHaveAttribute('data-player',/\d/);const before=await page.locator('body').getAttribute('data-player');
 if(!isMobile){await page.bringToFront();await page.keyboard.down('w');await expect(page.locator('body')).not.toHaveAttribute('data-player',before!);await page.keyboard.up('w');}
 else {const floor=screenPoint(page,0,0,-1.4);await page.touchscreen.tap(floor.x,floor.y);await expect(page.locator('body')).not.toHaveAttribute('data-player',before!);}
 const lookBefore=await page.locator('body').getAttribute('data-look');
 if(!isMobile){await page.mouse.move(600,300);await page.mouse.down({button:'right'});await page.mouse.move(660,320);await page.mouse.up({button:'right'});await page.mouse.wheel(0,-60);}
 else{const cdp=await page.context().newCDPSession(page);await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:400,y:150},{x:460,y:150}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:430,y:170},{x:510,y:170}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});}
 await expect(page.locator('body')).not.toHaveAttribute('data-look',lookBefore!);
 await page.screenshot({path:info.outputPath('cafe-play.png')});
 await info.attach('render-metrics',{body:JSON.stringify(await page.locator('body').evaluate(body=>({tier:body.dataset.tier,drawCalls:body.dataset.drawCalls,triangles:body.dataset.triangles,softwareFrameMs:body.dataset.frameMs}))),contentType:'application/json'});
 expect(Number(await page.locator('body').getAttribute('data-draw-calls'))).toBeLessThanOrEqual(80);
});
test('bowl drag to tap fills on fixed steps and returns to the mat',async({page,isMobile},info)=>{
 await enter(page);const bowl=screenPoint(page,1.4,.13,-.7),tap=screenPoint(page,-2,1.2,-3.55),home=screenPoint(page,1.4,0,-.7);
 if(isMobile){
  const session=await page.context().newCDPSession(page);
  await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:bowl.x,y:bowl.y}]});
  await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:bowl.x+15,y:bowl.y}]});
  await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:tap.x,y:tap.y}]});
  await expect(page.locator('#task-copy')).toContainText('Bring the bowl back',{timeout:15000});
  await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:home.x,y:home.y}]});await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 }else{
  await page.locator('.top-settings').click();await page.locator('input[name=holdToggle]').check();await page.locator('#close-settings').click();
  await page.mouse.move(bowl.x,bowl.y);await expect(page.locator('#hover-menu')).toBeVisible();await page.keyboard.press('2');await expect(page.locator('body')).toHaveAttribute('data-last-action','water-bowl:Fill');await page.mouse.click(bowl.x,bowl.y);await expect(page.locator('body')).toHaveAttribute('data-carry','water-bowl');
  await page.mouse.move(tap.x,tap.y);await expect(page.locator('#task-copy')).toContainText('Bring the bowl back',{timeout:15000});
  await page.mouse.move(home.x,home.y);await page.mouse.click(home.x,home.y);
 }
 await expect(page.locator('#chore-card')).toHaveClass(/complete/);await page.screenshot({path:info.outputPath('water-complete.png')});
});
test('portrait pauses behind the landscape guide',async({page})=>{await page.goto('./?tier=low');await page.setViewportSize({width:390,height:844});await expect(page.locator('#rotate')).toBeVisible();await page.setViewportSize({width:844,height:390});await expect(page.locator('#rotate')).toBeHidden();});

test('a dropped bowl can be picked up again and invalid drops return it',async({page,isMobile})=>{
 test.skip(isMobile,'Mouse carry complements the touch water-chore test.');await enter(page);
 const bowl=screenPoint(page,1.4,.13,-.7),drop=screenPoint(page,2.3,0,-1.6),placed=screenPoint(page,2.3,.13,-1.6);
 await page.mouse.move(bowl.x,bowl.y);await expect(page.locator('#hover-menu')).toBeVisible();await page.keyboard.press('1');await expect(page.locator('body')).toHaveAttribute('data-carry','water-bowl');
 await page.mouse.move(drop.x,drop.y);await page.mouse.click(drop.x,drop.y);await expect(page.locator('body')).toHaveAttribute('data-carry','');
 await page.mouse.move(placed.x,placed.y);await expect(page.locator('#hover-menu')).toBeVisible();await page.keyboard.press('1');await expect(page.locator('body')).toHaveAttribute('data-carry','water-bowl');
 await page.mouse.click(900,50);await expect(page.locator('body')).toHaveAttribute('data-carry','');await page.mouse.move(placed.x,placed.y);await expect(page.locator('#hover-menu')).toBeVisible();
});
test('lookdev loads the actual 65-bone capsule rig',async({page,isMobile},info)=>{await page.goto(`./?lookdev=cat&tier=${isMobile?'low':'desktop'}`);await expect(page.locator('body')).toHaveAttribute('data-ready','true');await expect(page.locator('body')).toHaveAttribute('data-bones','65');await expect(page.locator('#lookdev-status')).toContainText('capsule rig diagnostic');await page.screenshot({path:info.outputPath('capsule-lookdev.png')});});
test('Settings About shows the build and feedback opens a metadata-prefilled draft',async({page})=>{
 await page.goto('./?tier=low');await expect(page.locator('body')).toHaveAttribute('data-ready','true');await page.locator('.top-settings').click();
 const stamp=await page.locator('#build-stamp').textContent();await expect(page.locator('#about-build')).toContainText(stamp!);await expect(page.locator('#about-flags')).toContainText('Enabled flags:');
 await page.locator('#feedback').evaluate(link=>link.addEventListener('click',event=>event.preventDefault(),{once:true}));await page.locator('#feedback').click();
 const draft=new URL((await page.locator('#feedback').getAttribute('href'))!);expect(draft.searchParams.get('template')).toBe('playtest.yml');expect(draft.searchParams.get('build')).toContain(stamp!.split(' · ')[0]!);expect(draft.searchParams.get('channel')).toBe(stamp!.split(' · ')[1]);expect(draft.searchParams.get('tier')).toBe('low');expect(draft.searchParams.get('browser')).toMatch(/Mozilla/);expect(draft.searchParams.get('device')).toContain('viewport');
});
test('automatic tier boot settles before a patron can begin a draft',async({page})=>{
 await page.goto('./');await expect(page.locator('#start')).toBeEnabled({timeout:30000});await expect(page.locator('#start')).toHaveAttribute('aria-busy','false');await expect(page.locator('body')).toHaveAttribute('data-ready','true');
 await page.locator('#start').click();await page.locator('#patron-name').fill('Avery');const settledURL=page.url();
 // The benchmark resolves after two seconds; a draft must survive beyond that boundary.
 await page.waitForTimeout(2300);expect(page.url()).toBe(settledURL);await expect(page.locator('body')).toHaveAttribute('data-phase','create');await expect(page.locator('#patron-name')).toHaveValue('Avery');
});
