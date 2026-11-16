/** Shared output for music and effects, opened only when playback needs it. */
export class AudioMixer {
  #context: AudioContext | undefined;
  #output: GainNode | undefined;
  #volume: number;

  constructor(volume: number) { this.#volume = volume; }

  get context(): AudioContext { return this.#context ??= new AudioContext(); }

  get output(): GainNode {
    if (this.#output) return this.#output;
    const context = this.context;
    const output = context.createGain();
    output.gain.value = this.#volume ** 2;
    output.connect(context.destination);
    return this.#output = output;
  }

  setVolume(volume: number): void {
    this.#volume = volume;
    this.#output?.gain.setTargetAtTime(volume ** 2, this.context.currentTime, .08);
  }
}
