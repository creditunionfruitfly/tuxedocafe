import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { inspectMidi } from './midi.ts';
import { inspectSoundfont } from './soundfont.ts';
import { validateSchema } from './schema.ts';
import type { Schema } from './schema.ts';

const midiFile = () => readFileSync('audio/cues/cafe_day_a.mid');
const bankFile = () => readFileSync('audio/soundfont/cafe_placeholder.sf3');
const cueFile = () => JSON.parse(readFileSync('audio/cues.json', 'utf8'));
const schema = JSON.parse(readFileSync('audio/cues.schema.json', 'utf8')) as Schema;

describe('authored audio contract', () => {
  it('declares the original score and all three bank programs', () => {
    const midi = inspectMidi(midiFile()), presets = inspectSoundfont(bankFile());
    expect(midi.ppq).toBe(480);
    expect(midi.peak).toBe(6);
    expect(midi.channels.size).toBe(3);
    expect([...midi.presets].sort()).toEqual(['0:11', '0:32', '0:4']);
    expect([...presets].sort()).toEqual([...midi.presets].sort());
    expect(midi.markers.get('loopStart')).toEqual([0]);
    expect(midi.markers.get('loopEnd')).toEqual([15360]);
    expect(midi.ends).toEqual([15360, 15360, 15360, 15360]);
  });

  it('rejects non-type-1 and truncated MIDI files', () => {
    const bytes = midiFile(); bytes.writeUInt16BE(0, 8);
    expect(() => inspectMidi(bytes)).toThrow('type 1');
    expect(() => inspectMidi(midiFile().subarray(0, 24))).toThrow('Truncated');
  });

  it('rejects unterminated variable-length integers', () => {
    const bytes = midiFile(); bytes.fill(128, 22, 26);
    expect(() => inspectMidi(bytes)).toThrow('variable-length');
  });

  it('rejects note tails that remain held at the loop boundary', () => {
    const bytes = midiFile(), off = bytes.indexOf(Buffer.from([128, 61, 0]));
    expect(off).toBeGreaterThan(0);
    bytes[off] = 144; bytes[off + 2] = 64;
    expect(() => inspectMidi(bytes)).toThrow('release all');
  });

  it('rejects oversized, truncated and disguised PCM banks', () => {
    expect(() => inspectSoundfont(Buffer.alloc(12 * 1024 * 1024 + 1))).toThrow('12 MB');
    expect(() => inspectSoundfont(bankFile().subarray(0, 80))).toThrow('RIFF size');
    const bytes = bankFile(), shdr = bytes.indexOf('shdr');
    bytes.writeUInt16LE(1, shdr + 8 + 44);
    expect(() => inspectSoundfont(bytes)).toThrow('Vorbis-compressed');
  });

  it('validates required fields, caps, types, paths and unknown properties against the schema', () => {
    expect(validateSchema(cueFile(), schema)).toEqual([]);
    for (const mutate of [
      (value: ReturnType<typeof cueFile>) => { value.cues[0].voices.low = 25; },
      (value: ReturnType<typeof cueFile>) => { value.cues[0].ppq = 1.5; },
      (value: ReturnType<typeof cueFile>) => { value.cues[0].loopEnd = '15360'; },
      (value: ReturnType<typeof cueFile>) => { value.soundfont = '../external.sf3'; },
      (value: ReturnType<typeof cueFile>) => { value.cues[0].extra = true; },
      (value: ReturnType<typeof cueFile>) => { delete value.cues[0].voices; },
    ]) {
      const value = cueFile(); mutate(value);
      expect(validateSchema(value, schema).length).toBeGreaterThan(0);
    }
  });
});
