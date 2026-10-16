import { formatStamp,type BuildInfo } from '../core/build-info.ts';
/** The issue stays a draft until the player chooses to submit it on GitHub. */
export function feedbackUrl(info:BuildInfo,tier:string,browser:string,device:string):string {
  const url=new URL('https://github.com/creditunionfruitfly/tuxedocafe/issues/new');
  url.search=new URLSearchParams({template:'playtest.yml',build:`${info.version} (${info.commit})`,channel:info.channel,tier,browser,device}).toString();
  return url.href;
}
export function mountAbout(info:BuildInfo):void {
  const stamp=document.querySelector<HTMLElement>('#about-build');
  if(stamp)stamp.textContent=`${formatStamp(info)} · ${info.commit} · built ${info.builtAt}`;
  const flags=document.querySelector<HTMLElement>('#about-flags');
  if(flags)flags.textContent=`Enabled flags: ${document.body.dataset.flags||'none'}`;
  const feedback=document.querySelector<HTMLAnchorElement>('#feedback');
  if(feedback)feedback.addEventListener('click',()=>{
    const input=matchMedia('(pointer: coarse)').matches?'Touch':'Pointer';
    const device=`${input}; screen ${screen.width}×${screen.height}; viewport ${innerWidth}×${innerHeight}; DPR ${devicePixelRatio}`;
    feedback.href=feedbackUrl(info,document.body.dataset.tier??'unknown',navigator.userAgent,device);
  });
}
