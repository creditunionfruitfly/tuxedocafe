// M0 source validation. M3 adds runtime listening and automated Opus/AAC delivery.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import YAML from 'yaml';
import { checkSidecar } from '../provenance/sidecar.ts';
import { inspectMidi } from './midi.ts';
import { inspectSoundfont } from './soundfont.ts';
import { validateSchema } from './schema.ts';
import type { Schema } from './schema.ts';

interface Cue {
  id: string; midi: string; ppq: number; tempoBpm: number; bars: number;
  beatsPerBar: number; loopStart: number; loopEnd: number;
  voices: Record<string, number>;
  liveChanges: { channel: number }[];
}
interface CatSound {
  stem: string; sourceFormat: string; seconds: number; takes: number;
  events: string[]; caption: string; loop: boolean; loopStart: number;
  loopEnd: number | null; requiredBy: string; status: string;
}
const json = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8'));
const problems: string[] = [];
function assert(condition: boolean, message: string): asserts condition { if (!condition) throw new Error(message); }
function check(label: string, run: () => void): void {
  try { run(); } catch (error) { problems.push(`${label}: ${(error as Error).message}`); }
}
const licenses = new Set(Object.keys((YAML.parse(readFileSync('tools/provenance/allowlist.yaml', 'utf8')) as { licenses: object }).licenses));
function provenance(file: string, owner = false): void {
  const text = readFileSync(`${file}.prov.yaml`, 'utf8');
  const errors = checkSidecar(text, licenses);
  assert(errors.length === 0, errors.join('; '));
  if (owner) {
    const sidecar = YAML.parse(text) as { license: string; author_role: string };
    assert(sidecar.license === 'elevenlabs-paid' && sidecar.author_role === 'owner', `${file}: cat recordings require owner / elevenlabs-paid provenance`);
  }
}

check('cue manifest', () => {
  const raw = json('audio/cues.json');
  const errors = validateSchema(raw, json('audio/cues.schema.json') as Schema);
  assert(errors.length === 0, errors.join('; '));
  const { soundfont, cues } = raw as { soundfont: string; cues: Cue[] };
  provenance(soundfont);
  const bank = readFileSync(soundfont), presets = inspectSoundfont(bank), used = new Set<string>(), ids = new Set<string>();
  for (const cue of cues) check(cue.id, () => {
    assert(!ids.has(cue.id), 'Duplicate cue ID'); ids.add(cue.id);
    provenance(cue.midi);
    const midi = inspectMidi(readFileSync(cue.midi));
    assert(midi.ppq === cue.ppq, 'PPQ differs from manifest');
    assert(midi.tempos.length === 1 && Math.abs(60_000_000 / midi.tempos[0]! - cue.tempoBpm) < 0.001, 'Tempo differs from manifest');
    assert(cue.loopEnd - cue.loopStart === cue.bars * cue.beatsPerBar * cue.ppq, 'Loop does not span declared bars');
    for (const [name, tick] of [['loopStart', cue.loopStart], ['loopEnd', cue.loopEnd]] as const) {
      const markers = midi.markers.get(name);
      assert(markers?.length === 1 && markers[0] === tick, `Missing or mismatched ${name} marker`);
    }
    assert(midi.ends.every((tick) => tick === cue.loopEnd), 'Track must finish at loopEnd');
    assert(midi.channels.size <= 16, 'More than 16 channels');
    assert(Object.values(cue.voices).every((cap) => midi.peak <= cap), 'Peak voices exceed tier cap');
    for (const preset of midi.presets) { assert(presets.has(preset), `Program ${preset} absent from bank`); used.add(preset); }
    assert(cue.liveChanges.every((change) => midi.channels.has(change.channel)), 'Live change targets an unused channel');
    console.log(`${cue.id}: type 1, ${cue.bars} bars, ${midi.channels.size} channels, peak ${midi.peak} held voices (Low cap ${cue.voices.low}).`);
  });
  assert([...presets].every((preset) => used.has(preset)), 'SoundFont contains an unused instrument');
  console.log(`SF3: ${bank.length} bytes; ${presets.size} presets, within 12 MB.`);
});

check('owner cat manifest', () => {
  const manifest = json('audio/sfx/cat/manifest.json') as { version: number; sounds: CatSound[] };
  assert(manifest.version === 1 && Array.isArray(manifest.sounds), 'Expected v1 sounds array');
  const expected = [...readFileSync('README.md', 'utf8').matchAll(/\| `(sfx_cat_[a-z0-9_]+)_01\.(wav|mp3)` \| ([\d.]+) \| (\d+) \|/g)];
  assert(expected.length === 31 && manifest.sounds.length === expected.length, 'Expected all 31 README sounds');
  const stems = new Set<string>(), allowedFiles = new Set<string>();
  let pending = 0, takes = 0;
  for (const [index, sound] of manifest.sounds.entries()) {
    const row = expected[index]!;
    assert(sound.stem === row[1] && !stems.has(sound.stem), `Unknown, reordered or duplicate stem ${sound.stem}`); stems.add(sound.stem);
    assert(sound.seconds === Number(row[3]) && sound.takes === Number(row[4]), `${sound.stem}: duration/takes differ from README`);
    assert(sound.sourceFormat === row[2] && ['pending', 'ready'].includes(sound.status), `${sound.stem}: invalid source/status`);
    assert(typeof sound.caption === 'string' && sound.caption.trim().length > 0, `${sound.stem}: missing caption`);
    assert(Array.isArray(sound.events) && sound.events.length > 0 && sound.events.every((event) => /^cat\.[a-z_.]+$/.test(event)), `${sound.stem}: invalid events`);
    assert(sound.loop === sound.stem.endsWith('_loop') && sound.loopStart === 0 && sound.loopEnd === (sound.loop ? sound.seconds : null), `${sound.stem}: invalid loop points`);
    assert(sound.requiredBy === (index < 20 ? 'M2' : 'M5'), `${sound.stem}: invalid milestone`);
    for (let take = 1; take <= sound.takes; take++) {
      const stem = `${sound.stem}_${String(take).padStart(2, '0')}`;
      const names = [`${stem}.${sound.sourceFormat}`];
      if (sound.loop) names.push(`${stem}.wav`); // Owner's documented alternative to MP3 loops.
      names.forEach((name) => allowedFiles.add(name));
      if (sound.status === 'ready') assert(names.some((name) => existsSync(`audio/sfx/cat/src/${name}`)), `${stem}: missing owner take`);
    }
    if (sound.status === 'pending') pending++;
    takes += sound.takes;
  }
  assert(takes === 63, 'Expected 63 owner takes');
  const source = 'audio/sfx/cat/src';
  if (existsSync(source)) for (const file of readdirSync(source)) {
    if (file.startsWith('.') || file === 'README.md' || file.endsWith('.prov.yaml')) continue;
    assert(allowedFiles.has(file), `${file}: violates README file naming / take count`);
    provenance(`${source}/${file}`, true);
  }
  if (process.argv.includes('--milestone=M7')) assert(pending === 0, 'M7 requires every cat sound');
  console.log(`Cat sounds: ${manifest.sounds.length} entries / ${takes} takes; ${pending} pending owner deliveries (warning until M7).`);
});

if (problems.length > 0) { console.error(`Audio check failed:\n${problems.join('\n')}`); process.exit(1); }
console.log('Audio source checks passed. Runtime listening and fallback delivery are M3.');
