import { expect, it, vi } from 'vitest';
import { AudioMixer } from '../../src/audio/mixer.ts';
import { freshVisit } from '../../src/save/visit.ts';

it('applies the default boost on a shared output and can mute it', () => {
  const connect = vi.fn();
  const gain = { value: 1, setTargetAtTime: vi.fn() };
  const createContext = vi.fn(function () {
    return { createGain: () => ({ connect, gain }), destination: {}, currentTime: 1 };
  });
  vi.stubGlobal('AudioContext', createContext);
  try {
    const mixer = new AudioMixer(freshVisit().settings.master);
    expect(createContext).not.toHaveBeenCalled();
    const output = mixer.output;
    expect(20 * Math.log10(gain.value / .6 ** 2)).toBeCloseTo(6.05);
    expect(connect).toHaveBeenCalledWith(mixer.context.destination);
    expect(mixer.output).toBe(output);
    mixer.setVolume(0);
    expect(gain.setTargetAtTime).toHaveBeenCalledWith(0, 1, .08);
  } finally {
    vi.unstubAllGlobals();
  }
});
