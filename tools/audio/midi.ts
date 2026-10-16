/** SMF inspection: bounded parsing, merged-track polyphony and bank/program usage. */
export interface MidiInfo {
  ppq: number;
  peak: number;
  channels: Set<number>;
  presets: Set<string>;
  markers: Map<string, number[]>;
  tempos: number[];
  ends: number[];
}

export function inspectMidi(data: Buffer): MidiInfo {
  function require(condition: boolean, message: string): asserts condition {
    if (!condition) throw new Error(message);
  }
  require(data.length >= 14 && data.toString('ascii', 0, 4) === 'MThd', 'Missing MIDI header');
  require(data.readUInt32BE(4) === 6 && data.readUInt16BE(8) === 1, 'MIDI must be SMF type 1');
  const tracks = data.readUInt16BE(10), ppq = data.readUInt16BE(12);
  require(tracks >= 2 && ppq > 0 && ppq < 32768, 'Type 1 requires multiple tracks and PPQ timing');
  const info: MidiInfo = { ppq, peak: 0, channels: new Set(), presets: new Set(), markers: new Map(), tempos: [], ends: [] };
  const events: { tick: number; status: number; a: number; b: number }[] = [];
  let cursor = 14;
  for (let track = 0; track < tracks; track++) {
    require(cursor + 8 <= data.length && data.toString('ascii', cursor, cursor + 4) === 'MTrk', 'Missing MIDI track');
    const end = cursor + 8 + data.readUInt32BE(cursor + 4);
    cursor += 8;
    require(end <= data.length, 'Truncated MIDI track');
    let tick = 0, running = 0, ended = false;
    const byte = () => { require(cursor < end, 'Truncated MIDI event'); return data[cursor++]!; };
    const vlq = () => {
      let value = 0;
      for (let n = 0; n < 4; n++) {
        const b = byte(); value = value * 128 + (b & 127);
        if (!(b & 128)) return value;
      }
      throw new Error('Invalid MIDI variable-length quantity');
    };
    while (cursor < end) {
      tick += vlq();
      let status = byte();
      if (status < 128) { require(running >= 128, 'Missing MIDI running status'); cursor--; status = running; }
      if (status === 255 || status === 240 || status === 247) {
        running = 0;
        const kind = status === 255 ? byte() : -1, size = vlq();
        require(cursor + size <= end, 'Truncated MIDI meta/SysEx');
        if (kind === 6) {
          const marker = data.toString('utf8', cursor, cursor + size);
          info.markers.set(marker, [...(info.markers.get(marker) ?? []), tick]);
        }
        if (kind === 81) { require(size === 3, 'Invalid tempo'); info.tempos.push(data.readUIntBE(cursor, 3)); }
        if (kind === 88) require(size === 4 && data[cursor] === 4 && data[cursor + 1] === 2, 'Only 4/4 cues supported');
        if (kind === 47) { require(size === 0 && cursor === end, 'End-of-track must be final'); ended = true; }
        cursor += size;
      } else {
        require(status >= 128 && status < 240, 'Invalid MIDI status');
        running = status;
        const a = byte(), b = (status & 240) === 192 || (status & 240) === 208 ? 0 : byte();
        require(a < 128 && b < 128, 'Invalid MIDI channel data');
        events.push({ tick, status, a, b });
      }
    }
    require(ended, 'Missing MIDI end-of-track');
    info.ends.push(tick);
  }
  require(cursor === data.length, 'Trailing MIDI bytes');
  const programs = Array<number>(16).fill(0), msb = Array<number>(16).fill(0), lsb = Array<number>(16).fill(0);
  const held = new Map<string, number>();
  let active = 0;
  // Stable ordering preserves each track's program/controllers before its notes.
  for (const event of events.sort((a, b) => a.tick - b.tick)) {
    const { status, a, b } = event, channel = status & 15, kind = status & 240;
    info.channels.add(channel);
    if (kind === 192) programs[channel] = a;
    if (kind === 176) {
      if (a === 0) msb[channel] = b;
      if (a === 32) lsb[channel] = b;
      require(a !== 64 || b < 64, 'Sustain pedal requires a tail-aware validator; disabled in v0 cues');
    }
    const key = `${channel}:${a}`, count = held.get(key) ?? 0;
    if (kind === 144 && b > 0) {
      const bank = channel === 9 ? 128 : msb[channel]! * 128 + lsb[channel]!;
      info.presets.add(`${bank}:${programs[channel]}`);
      held.set(key, count + 1); active++; info.peak = Math.max(info.peak, active);
    } else if (kind === 128 || kind === 144) {
      require(count > 0, `Unmatched MIDI note-off ${key}`);
      held.set(key, count - 1); active--;
    }
  }
  require(active === 0 && info.peak > 0, 'Cue must contain notes and release all of them');
  return info;
}
