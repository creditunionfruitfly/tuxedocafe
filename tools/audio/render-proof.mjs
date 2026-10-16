// Optional M0 proof, without a runtime dependency. Supply an installed core module:
// node tools/audio/render-proof.mjs /tmp/proof/node_modules/spessasynth_core/dist/index.js /tmp/cafe.wav
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const [moduleFile, output] = process.argv.slice(2);
if (!moduleFile || !output) throw new Error('Expected spessasynth_core module path and output WAV path.');
const { BasicMIDI, SoundBankLoader, SpessaLog, SpessaSynthProcessor, SpessaSynthSequencer, audioToWav } =
  await import(pathToFileURL(resolve(moduleFile)).href);
SpessaLog.setLogLevel(false, false, false);
const bytes = (path) => new Uint8Array(readFileSync(path)).buffer;
const midi = BasicMIDI.fromArrayBuffer(bytes('audio/cues/cafe_day_a.mid'));
const bank = SoundBankLoader.fromArrayBuffer(bytes('audio/soundfont/cafe_placeholder.sf3'));
const sampleRate = 32000;
const synth = new SpessaSynthProcessor(sampleRate, { eventsEnabled: false });
synth.soundBankManager.addSoundBank(bank, 'original');
await synth.processorInitialized;
const seq = new SpessaSynthSequencer(synth);
seq.loadNewSongList([midi]);
seq.loopCount = 0;
seq.play();
const length = Math.ceil((midi.duration + 1) * sampleRate);
const left = new Float32Array(length), right = new Float32Array(length);
let peakVoices = 0;
for (let offset = 0; offset < length; offset += 128) {
  seq.processTick();
  synth.process(left, right, offset, Math.min(128, length - offset));
  peakVoices = Math.max(peakVoices, synth.voiceCount);
}
let peak = 0, sum = 0;
for (const value of left) { peak = Math.max(peak, Math.abs(value)); sum += value * value; }
const rms = Math.sqrt(sum / length);
if (!(peak > 0.001 && rms > 0.0001 && Number.isFinite(peak))) throw new Error('Silent or invalid render.');
if (peakVoices > 24) throw new Error(`Low phone polyphony exceeded: ${peakVoices}`);
writeFileSync(output, new Uint8Array(audioToWav([left, right], sampleRate, { normalizeAudio: false })));
console.log(JSON.stringify({ duration: midi.duration, samples: bank.samples.length, presets: bank.presets.length, peakVoices, peak, rms }));
