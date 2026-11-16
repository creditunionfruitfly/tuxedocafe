// Render the shipped cues through the same synth core to verify playback normalization.
// Run after build-audio.ts with: node tools/audio/measure-music.ts
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { BasicMIDI, SoundBankLoader, SpessaLog, SpessaSynthProcessor, SpessaSynthSequencer } from 'spessasynth_core';
import music from '../../audio/music.json' with { type: 'json' };

SpessaLog.setLogLevel(false, false, false);
const binary = (path: string): ArrayBuffer => new Uint8Array(readFileSync(path)).buffer;
for (const track of music.tracks) {
  const rate = 48000;
  const synth = new SpessaSynthProcessor(rate, { eventsEnabled: false });
  synth.soundBankManager.addSoundBank(SoundBankLoader.fromArrayBuffer(binary(`public/assets/${music.bank}`)), 'cafe');
  await synth.processorInitialized;
  const midi = BasicMIDI.fromArrayBuffer(binary(`public/assets/audio/${track.file}`));
  const sequencer = new SpessaSynthSequencer(synth);
  sequencer.loadNewSongList([midi]);
  sequencer.loopCount = 0;
  sequencer.play();
  const count = Math.ceil(rate * (midi.duration + 2));
  const left = new Float32Array(count), right = new Float32Array(count);
  for (let offset = 0; offset < count; offset += 128) {
    sequencer.processTick();
    synth.process(left, right, offset, Math.min(128, count - offset));
  }
  const output = new Float32Array(count * 2);
  const gain = .9 * 10 ** (track.gainDb / 20);
  for (let i = 0; i < count; i++) {
    output[2 * i] = left[i]! * gain;
    output[2 * i + 1] = right[i]! * gain;
  }
  const result = spawnSync('ffmpeg', ['-hide_banner', '-f', 'f32le', '-ar', String(rate), '-ac', '2', '-i', 'pipe:0', '-af', 'ebur128=peak=true', '-f', 'null', '-'], { input: Buffer.from(output.buffer), maxBuffer: 8 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr.toString());
  const report = result.stderr.toString();
  const momentary = Math.max(...[...report.matchAll(/ M:\s*(-?[\d.]+)/g)].map(match => Number(match[1])));
  const integrated = Number([...report.matchAll(/I:\s*(-?[\d.]+) LUFS/g)].at(-1)?.[1]);
  const peak = Number([...report.matchAll(/Peak:\s*(-?[\d.]+) dBFS/g)].at(-1)?.[1]);
  console.log(`${track.id}: ${integrated} LUFS integrated, ${momentary} LUFS max momentary, ${peak} dBTP`);
  if (![integrated, momentary, peak].every(Number.isFinite) || momentary > -20 || peak > -1) {
    throw new Error(`${track.id} exceeds the audio loudness limits or could not be measured`);
  }
}
