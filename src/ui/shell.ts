import type { EventBus } from '../core/events.ts';
import type { Visit,Profile } from '../save/visit.ts';
import { cleanSettings } from '../input/settings.ts';
export function mountShell(bus: EventBus,visit: Visit,save:()=>Promise<void>): void {
  const body=document.body, title=document.querySelector<HTMLElement>('#title-screen')!,creator=document.querySelector<HTMLElement>('#creator')!,hud=document.querySelector<HTMLElement>('#play-hud')!,form=document.querySelector<HTMLFormElement>('#patron-form')!,settings=document.querySelector<HTMLDialogElement>('#settings-dialog')!,settingsForm=document.querySelector<HTMLFormElement>('#settings-form')!;
  let playing=false;
  const setPlaying=(value:boolean):void=>{playing=value;body.dataset.phase=value?'play':'title';title.hidden=value;hud.hidden=!value;creator.hidden=true;bus.emit('session',{playing:value});};
  const start=():void=>{
    if(visit.profile){bus.emit('profile',visit.profile);setPlaying(true);bus.emit('notice',{text:`Welcome back, ${visit.profile.name}. Take your time.`});return;}
    title.hidden=true;creator.hidden=false;body.dataset.phase='create';form.querySelector<HTMLInputElement>('input[name="name"]')?.focus();
  };
  document.querySelector<HTMLButtonElement>('#start')!.onclick=start;
  if(visit.profile){document.querySelector('#start')!.textContent='Continue your visit';document.querySelector('#returning')!.textContent=`Your usual spot is waiting, ${visit.profile.name}.`;}
  document.querySelector<HTMLButtonElement>('#creator-back')!.onclick=()=>{creator.hidden=true;title.hidden=false;body.dataset.phase='title';};
  form.addEventListener('input',()=>{const data=new FormData(form);const skin=String(data.get('skin'));const sleeve=String(data.get('sleeve'));body.style.setProperty('--hand-skin',skin);body.style.setProperty('--hand-sleeve',sleeve);});
  form.addEventListener('submit',event=>{event.preventDefault();if(!form.reportValidity())return;const data=new FormData(form);const profile:Profile={name:String(data.get('name')).trim().slice(0,24),pronouns:String(data.get('pronouns')),skin:String(data.get('skin')),sleeve:String(data.get('sleeve'))};if(!profile.name)return;visit.profile=profile;void save();bus.emit('profile',profile);setPlaying(true);bus.emit('notice',{text:`Welcome, ${profile.name}. The cats set the pace here.`});});
  const applySettings=():void=>{body.classList.toggle('left-handed',visit.settings.leftHanded);body.classList.toggle('reduced-motion',visit.settings.reducedMotion);bus.emit('settings',visit.settings);};
  for(const [name,value] of Object.entries(visit.settings)){
    const input=settingsForm.elements.namedItem(name);if(input instanceof HTMLInputElement){if(input.type==='checkbox')input.checked=Boolean(value);else input.value=String(value);}else if(input instanceof HTMLSelectElement)input.value=String(value);
  }
  settingsForm.addEventListener('input',()=>{const data=new FormData(settingsForm);Object.assign(visit.settings,cleanSettings({reducedMotion:data.has('reducedMotion'),leftHanded:data.has('leftHanded'),holdToggle:data.has('holdToggle'),captions:data.has('captions'),holdMs:Number(data.get('holdMs')),tier:String(data.get('tier')),music:Number(data.get('music')),effects:Number(data.get('effects'))}));applySettings();void save();});
  document.querySelectorAll<HTMLButtonElement>('[data-settings]').forEach(button=>{button.onclick=()=>{bus.emit('session',{playing:false});settings.showModal();};});
  document.querySelector<HTMLButtonElement>('#close-settings')!.onclick=()=>settings.close();settings.addEventListener('close',()=>bus.emit('session',{playing}));
  document.querySelector<HTMLButtonElement>('#leave')!.onclick=()=>{void save();setPlaying(false);document.querySelector('#start')!.textContent='Continue your visit';};
  document.querySelector<HTMLButtonElement>('#help')!.onclick=()=>{const help=document.querySelector<HTMLElement>('#controls')!;help.hidden=!help.hidden;};
  bus.on('chore:progress',({progress})=>{const meter=document.querySelector<HTMLProgressElement>('#water-progress')!;meter.hidden=false;meter.value=progress;document.querySelector('#task-copy')!.textContent=progress>=1?'Fresh water! Bring the bowl back to its mat.':`Filling the water bowl · ${Math.round(progress*100)}%`;});
  const completed=():void=>{document.querySelector('#task-copy')!.textContent='Fresh water, happy café. Thank you!';document.querySelector('#chore-card')!.classList.add('complete');document.querySelector<HTMLProgressElement>('#water-progress')!.hidden=true;};
  bus.on('chore:done',()=>{visit.waterDone=true;void save();completed();bus.emit('notice',{text:'Water bowl refreshed. Nicely done!'});});if(visit.waterDone)completed();
  let noticeTimer=0;bus.on('notice',({text})=>{const toast=document.querySelector<HTMLElement>('#notice')!;toast.textContent=text;toast.hidden=false;clearTimeout(noticeTimer);noticeTimer=window.setTimeout(()=>{toast.hidden=true;},6500);});
  applySettings();setPlaying(false);
}
