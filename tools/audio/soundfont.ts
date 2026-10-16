/** Structural SF3 validation. The optional render proof also decodes every sample. */
export function inspectSoundfont(data: Buffer): Set<string> {
  function require(condition: boolean, message: string): asserts condition {
    if (!condition) throw new Error(message);
  }
  require(data.length <= 12 * 1024 * 1024, 'SoundFont exceeds 12 MB');
  require(data.length >= 12 && data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'sfbk', 'Missing SF3 RIFF/sfbk header');
  require(data.readUInt32LE(4) + 8 === data.length, 'Invalid SoundFont RIFF size');
  const chunks = new Map<string, Buffer>();
  function walk(start: number, end: number): void {
    let cursor = start;
    while (cursor < end) {
      require(cursor + 8 <= end, 'Truncated SF3 chunk header');
      const id = data.toString('ascii', cursor, cursor + 4), size = data.readUInt32LE(cursor + 4);
      const next = cursor + 8 + size;
      require(next + size % 2 <= end, `Truncated SF3 ${id}`);
      if (id === 'LIST') { require(size >= 4, 'Invalid SF3 LIST'); walk(cursor + 12, next); }
      else { require(!chunks.has(id), `Duplicate SF3 ${id}`); chunks.set(id, data.subarray(cursor + 8, next)); }
      cursor = next + size % 2;
    }
  }
  walk(12, data.length);
  const table = (id: string, stride: number, minimum = stride) => {
    const bytes = chunks.get(id);
    require(!!bytes && bytes.length >= minimum && bytes.length % stride === 0, `Invalid SF3 ${id} table`);
    return bytes;
  };
  const version = table('ifil', 4);
  require(version.readUInt16LE(0) === 3, 'Bank must contain SF3 version 3 samples');
  const presets = table('phdr', 38, 76), samples = table('shdr', 46, 92);
  const pcm = chunks.get('smpl');
  require(!!pcm && pcm.length > 0, 'Missing SF3 sample payload');
  const keys = new Set<string>();
  for (let i = 0; i < presets.length - 38; i += 38) {
    const key = `${presets.readUInt16LE(i + 22)}:${presets.readUInt16LE(i + 20)}`;
    require(!keys.has(key), `Duplicate SF3 preset ${key}`); keys.add(key);
  }
  require(presets.toString('ascii', presets.length - 38, presets.length - 35) === 'EOP', 'Missing SF3 EOP terminal');
  require(samples.toString('ascii', samples.length - 46, samples.length - 43) === 'EOS', 'Missing SF3 EOS terminal');
  for (let i = 0; i < samples.length - 46; i += 46) {
    const start = samples.readUInt32LE(i + 20), end = samples.readUInt32LE(i + 24);
    require(start < end && end <= pcm.length, 'SF3 sample offsets outside payload');
    require((samples.readUInt16LE(i + 44) & 16) !== 0 && pcm.toString('ascii', start, start + 4) === 'OggS', 'SF3 sample must be Vorbis-compressed');
    require(samples.readUInt32LE(i + 36) > 0 && samples[i + 40]! <= 127, 'Invalid SF3 sample pitch/rate');
  }
  for (const [id, stride] of [['pbag', 4], ['pmod', 10], ['pgen', 4], ['inst', 22], ['ibag', 4], ['imod', 10], ['igen', 4]] as const) table(id, stride);
  return keys;
}
