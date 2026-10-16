import { describe, expect, it } from 'vitest';
import { checkSidecar } from '../../tools/provenance/sidecar.ts';

const licenses = new Set(['original', 'CC0-1.0', 'elevenlabs-paid']);

const valid = [
  'source: ElevenLabs Sound Effects',
  'tool: eleven_text_to_sound_v2',
  'date: 2026-10-20',
  'license: elevenlabs-paid',
  'author_role: owner',
  'prompt: Close-mic recording of a relaxed house cat purring softly, isolated.',
].join('\n');

describe('checkSidecar', () => {
  it('accepts a complete sidecar', () => {
    expect(checkSidecar(valid, licenses)).toEqual([]);
  });

  it('names each missing field', () => {
    expect(checkSidecar('source: Blender', licenses)).toEqual([
      'needs "tool"',
      'needs "date"',
      'needs "license"',
      'needs "author_role"',
    ]);
  });

  it('rejects licenses outside the allowlist, bad dates and unknown roles', () => {
    const text = valid.replace('elevenlabs-paid', 'CC-BY-NC-4.0').replace('2026-10-20', '20 Oct').replace('owner', 'intern');
    expect(checkSidecar(text, licenses)).toEqual([
      '"date" must be YYYY-MM-DD',
      'license "CC-BY-NC-4.0" is not in tools/provenance/allowlist.yaml',
      'author_role must be one of owner, master, engine, artist, composer, third-party',
    ]);
  });

  it('reports broken YAML instead of throwing', () => {
    expect(checkSidecar('source: [unclosed', licenses)[0]).toMatch(/not valid YAML/);
    expect(checkSidecar('- a list', licenses)).toEqual(['must be a YAML mapping']);
  });
});
