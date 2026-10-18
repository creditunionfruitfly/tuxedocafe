import music from '../../audio/music.json' with { type: 'json' };
import processorUrl from 'spessasynth_lib/dist/spessasynth_processor.min.js?url';
import { assetUrl } from '../core/assets.ts';

export interface Track { id: string; title: string; mood: string; file: string }
/** The parts of the synth the jukebox drives; tests swap in a fake. */
export interface MusicEngine { play(midi: ArrayBuffer): void; pause(): void; volume(value: number): void }

/**
 * Loads spessasynth_lib only on the first gesture (AudioContext rules, and it stays out of the boot
 * chunk), then plays the café cues on the original SF3 bank with endless loops on their markers.
 */
async function loadEngine(): Promise<MusicEngine> {
  const { WorkletSynthesizer, Sequencer } = await import('spessasynth_lib');
  const context = new AudioContext(), gain = context.createGain();
  await context.audioWorklet.addModule(processorUrl);
  const synth = new WorkletSynthesizer(context);
  synth.connect(gain); gain.connect(context.destination);
  await synth.soundBankManager.addSoundBank(await (await fetch(assetUrl(music.bank))).arrayBuffer(), 'cafe');
  await synth.isReady;
  const sequencer = new Sequencer(synth);
  return {
    play(midi) { void context.resume(); sequencer.loadNewSongList([{ binary: midi }]); sequencer.loopCount = Infinity; sequencer.play(); },
    pause() { sequencer.pause(); },
    // Perceptual curve, and a quiet ceiling so music sits under gameplay sounds.
    volume(value) { gain.gain.setTargetAtTime(value * value * .9, context.currentTime, .08); },
  };
}

export class Jukebox {
  readonly tracks: readonly Track[] = music.tracks;
  index = 0; playing = false;
  #engine: Promise<MusicEngine> | null = null; #volume: number; readonly #load: () => Promise<MusicEngine>;
  constructor(volume: number, load: () => Promise<MusicEngine> = loadEngine) { this.#volume = volume; this.#load = load; }
  get track(): Track { return this.tracks[this.index]!; }
  async play(index = this.index): Promise<void> {
    this.index = (index + this.tracks.length) % this.tracks.length; this.playing = true;
    const engine = await (this.#engine ??= this.#load());
    engine.volume(this.#volume);
    engine.play(await (await fetch(assetUrl(`audio/${this.track.file}`))).arrayBuffer());
  }
  async toggle(): Promise<void> { if (this.playing) { this.playing = false; (await this.#engine)?.pause(); } else await this.play(); }
  next(): Promise<void> { return this.play(this.index + 1); }
  previous(): Promise<void> { return this.play(this.index - 1); }
  async setVolume(value: number): Promise<void> { this.#volume = Math.max(0, Math.min(1, value)); (await this.#engine)?.volume(this.#volume); }
}
