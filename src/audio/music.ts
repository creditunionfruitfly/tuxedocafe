import soundfonts from '../../audio/soundfonts.json' with { type: 'json' };
import type { SoundfontId } from '../input/settings.ts';
import music from '../../audio/music.json' with { type: 'json' };
import processorUrl from 'spessasynth_lib/dist/spessasynth_processor.min.js?url';
import { assetUrl } from '../core/assets.ts';
import type { AudioMixer } from './mixer.ts';

export interface Track { id: string; title: string; mood: string; file: string; gainDb: number; c64GainDb: number }
/** The parts of the synth the jukebox drives; tests swap in a fake. */
export interface MusicEngine { play(midi: ArrayBuffer): void; pause(): void; volume(value: number, gainDb: number): void; soundfont(id: SoundfontId): Promise<void> }

/**
 * Loads spessasynth_lib only on the first gesture (AudioContext rules, and it stays out of the boot
 * chunk), then plays the café cues on the original SF3 bank with endless loops on their markers.
 */
async function loadEngine(mixer: AudioMixer, initialBank: SoundfontId): Promise<MusicEngine> {
  const { WorkletSynthesizer, Sequencer } = await import('spessasynth_lib');
  const context = mixer.context, gain = context.createGain();
  await context.audioWorklet.addModule(processorUrl);
  const synth = new WorkletSynthesizer(context);
  synth.connect(gain); gain.connect(mixer.output);
  const loaded = new Set<SoundfontId>();
  const loadBank = async (id: SoundfontId): Promise<void> => {
    if (loaded.has(id)) return;
    const response = await fetch(assetUrl(soundfonts[id].file));
    if (!response.ok) throw new Error(`Could not load ${soundfonts[id].name}`);
    await synth.soundBankManager.addSoundBank(await response.arrayBuffer(), id);
    loaded.add(id);
  };
  await loadBank(initialBank);
  await synth.isReady;
  const sequencer = new Sequencer(synth);
  return {
    async soundfont(id) {
      await loadBank(id);
      const position = sequencer.currentTime, paused = sequencer.paused;
      synth.stopAll(true);
      synth.soundBankManager.priorityOrder = [id, ...[...loaded].filter(bank => bank !== id)];
      sequencer.currentTime = position;
      if (paused) sequencer.pause();
    },
    play(midi) { void context.resume(); sequencer.loadNewSongList([{ binary: midi }]); sequencer.loopCount = Infinity; sequencer.play(); },
    pause() { sequencer.pause(); },
    // Perceptual volume curve with measured per-cue normalization.
    volume(value, gainDb) { gain.gain.setTargetAtTime(value * value * .9 * 10 ** (gainDb / 20), context.currentTime, .08); },
  };
}

export class Jukebox {
  readonly tracks: readonly Track[] = music.tracks;
  index = 0; playing = false;
  #engine: MusicEngine | null = null;
  #pending: Promise<void> = Promise.resolve();
  #volume: number;
  #soundfont: SoundfontId;
  #activeBank: SoundfontId;
  #revision = 0;
  readonly #load: (id: SoundfontId) => Promise<MusicEngine>;
  constructor(volume: number, mixer: AudioMixer, load: (id: SoundfontId) => Promise<MusicEngine> = id => loadEngine(mixer, id), soundfont: SoundfontId = 'aero') {
    this.#volume = volume; this.#soundfont = this.#activeBank = soundfont; this.#load = load;
  }
  get track(): Track { return this.tracks[this.index]!; }
  get soundfont(): SoundfontId { return this.#soundfont; }
  get gainDb(): number { return this.#activeBank === 'c64' ? this.track.c64GainDb : this.track.gainDb; }
  #run(action: () => Promise<void>): Promise<void> {
    const result = this.#pending.then(action);
    this.#pending = result.catch(() => {});
    return result;
  }
  play(index = this.index): Promise<void> {
    this.index = (index + this.tracks.length) % this.tracks.length; this.playing = true;
    const revision = ++this.#revision;
    return this.#run(async () => {
      if (revision !== this.#revision) return;
      if (!this.#engine) {
        const bank = this.#soundfont;
        this.#engine = await this.#load(bank);
        this.#activeBank = bank;
      }
      const response = await fetch(assetUrl(`audio/${this.track.file}`));
      if (!response.ok) throw new Error('Could not load music');
      const midi = await response.arrayBuffer();
      if (revision !== this.#revision) return;
      this.#engine.volume(this.#volume, this.gainDb);
      this.#engine.play(midi);
    });
  }
  toggle(): Promise<void> {
    if (!this.playing) return this.play();
    this.playing = false; ++this.#revision;
    return this.#run(async () => { this.#engine?.pause(); });
  }
  next(): Promise<void> { return this.play(this.index + 1); }
  previous(): Promise<void> { return this.play(this.index - 1); }
  setVolume(value: number): Promise<void> {
    this.#volume = Math.max(0, Math.min(1, value));
    return this.#run(async () => { this.#engine?.volume(this.#volume, this.gainDb); });
  }
  setSoundfont(id: SoundfontId): Promise<void> {
    if (id === this.#soundfont) return this.#pending;
    this.#soundfont = id;
    return this.#run(async () => {
      if (id !== this.#soundfont || !this.#engine) return;
      try {
        await this.#engine.soundfont(id);
        this.#activeBank = id;
        this.#engine.volume(this.#volume, this.gainDb);
      } catch (error) {
        if (this.#soundfont === id) this.#soundfont = this.#activeBank;
        throw error;
      }
    });
  }
}
