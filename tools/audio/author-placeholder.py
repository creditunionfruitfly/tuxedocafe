"""Author the original M0 MIDI and three-sample SF3; requires ffmpeg/libvorbis."""
from array import array
import math
from pathlib import Path
import struct
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
PPQ, BARS, RATE = 480, 8, 32000
END = PPQ * 4 * BARS


def chunk(tag, data):
    return tag.encode() + struct.pack('<I', len(data)) + data + b'\0' * (len(data) % 2)


def name(text):
    return text.encode()[:20].ljust(20, b'\0')


def vlq(value):
    result = [value & 127]
    while value >> 7:
        value >>= 7
        result.insert(0, (value & 127) | 128)
    return bytes(result)


def meta(kind, text):
    data = text.encode() if isinstance(text, str) else text
    return bytes([255, kind]) + vlq(len(data)) + data


def track(events):
    data, last = b'', 0
    for tick, priority, event in sorted(events):
        data += vlq(tick - last) + event
        last = tick
    data += vlq(END - last) + meta(47, b'')
    return b'MTrk' + struct.pack('>I', len(data)) + data


def note(events, channel, tick, pitch, length, velocity):
    events.extend([(tick, 2, bytes([144 + channel, pitch, velocity])),
                   (tick + length, 1, bytes([128 + channel, pitch, 0]))])


def score():
    conductor = [(0, 0, meta(3, 'Sunlit Counter / original M0 cue')),
                 (0, 0, meta(81, (625000).to_bytes(3, 'big'))),
                 (0, 0, meta(88, bytes([4, 2, 24, 8]))),
                 (0, 0, meta(6, 'loopStart')), (END, 0, meta(6, 'loopEnd'))]
    parts = [[(0, 0, meta(3, title)), (0, 0, bytes([192 + c, program])),
              (0, 0, bytes([176 + c, 7, volume])),
              (0, 0, bytes([176 + c, 10, pan]))]
             for c, (title, program, volume, pan) in enumerate([
                 ('Glass Felt', 4, 80, 53), ('Air Bar', 11, 67, 78),
                 ('Wood Pluck', 32, 83, 64)])]
    # Independently authored voicings and phrase; no external score or MIDI.
    voicings = [[61, 64, 66, 69], [60, 64, 69, 71], [59, 64, 66, 68],
                [57, 61, 62, 66], [59, 62, 66, 69], [58, 62, 67, 69],
                [57, 62, 64, 67], [57, 61, 66, 71]]
    roots = [38, 41, 40, 35, 43, 39, 45, 45]
    melody = [[(240, 78, 360), (1080, 73, 300)], [(720, 76, 240), (1440, 71, 300)],
              [(480, 75, 360)], [(240, 73, 240), (1200, 78, 300)],
              [(480, 81, 360), (1320, 78, 240)], [(720, 79, 240), (1440, 74, 240)],
              [(240, 76, 360)], [(480, 73, 300), (1320, 69, 240)]]
    for bar in range(BARS):
        start = bar * 4 * PPQ
        for offset in [0, 1080]:
            for pitch in voicings[bar]:
                note(parts[0], 0, start + offset, pitch, 420, 49 + bar % 3)
        for offset, pitch, duration in melody[bar]:
            note(parts[1], 1, start + offset, pitch, duration, 58)
        for offset, pitch in [(0, roots[bar]), (960, roots[bar] + 7)]:
            note(parts[2], 2, start + offset, pitch, 660, 67)
    data = b'MThd' + struct.pack('>IHHH', 6, 1, 4, PPQ)
    (ROOT / 'audio/cues/cafe_day_a.mid').write_bytes(data + track(conductor) + b''.join(map(track, parts)))


def soundfont():
    samples, headers, position = [], [], 0
    instruments = [('Glass Felt', 4, 60, 3.0), ('Air Bar', 11, 72, 3.0),
                   ('Wood Pluck', 32, 36, 2.0)]
    for index, (title, program, key, duration) in enumerate(instruments):
        frequency = 440 * 2 ** ((key - 69) / 12)
        audio = array('f')
        for frame in range(int(RATE * duration)):
            t = frame / RATE
            phase = math.tau * frequency * t
            attack = min(1, t / 0.006)
            fade = min(1, (duration - t) / 0.08)
            if index == 0:
                value = (math.sin(phase) + 0.24 * math.exp(-4 * t) * math.sin(3 * phase)) * math.exp(-1.6 * t)
            elif index == 1:
                value = (math.sin(phase) + 0.16 * math.sin(4 * phase)) * math.exp(-1.8 * t)
            else:
                value = (math.sin(phase) + 0.3 * math.sin(2 * phase) + 0.1 * math.sin(3 * phase)) * math.exp(-3 * t)
            audio.append(0.4 * attack * fade * value)
        if sys.byteorder != 'little':
            audio.byteswap()
        encoded = subprocess.run(['ffmpeg', '-v', 'error', '-fflags', '+bitexact',
                                  '-f', 'f32le', '-ar', str(RATE), '-ac', '1', '-i', 'pipe:0',
                                  '-c:a', 'libvorbis', '-q:a', '3', '-flags:a', '+bitexact',
                                  '-map_metadata', '-1', '-fflags', '+bitexact', '-f', 'ogg', 'pipe:1'],
                                 input=audio.tobytes(), stdout=subprocess.PIPE, check=True).stdout
        samples.append(encoded)
        headers.append(struct.pack('<20sIIIIIBbHH', name(title), position,
                                   position + len(encoded), 0, len(audio), RATE, key, 0, 0, 17))
        position += len(encoded)
    info = chunk('ifil', struct.pack('<HH', 3, 0))
    for tag, text in [('isng', 'EMU8000'), ('INAM', 'Tuxedo Cafe Original Prototype'),
                      ('ICOP', 'Original Tuxedo Cafe; no third-party samples'),
                      ('ISFT', 'tools/audio/author-placeholder.py + ffmpeg')]:
        info += chunk(tag, text.encode() + b'\0')
    pdta = chunk('phdr', b''.join(struct.pack('<20sHHHIII', name(title), program, 0, i, 0, 0, 0)
                                 for i, (title, program, _, _) in enumerate(instruments)) +
                 struct.pack('<20sHHHIII', name('EOP'), 0, 0, 3, 0, 0, 0))
    pdta += chunk('pbag', b''.join(struct.pack('<HH', i, 0) for i in range(4)))
    pdta += chunk('pmod', bytes(10))
    pdta += chunk('pgen', b''.join(struct.pack('<HH', 41, i) for i in range(3)) + bytes(4))
    pdta += chunk('inst', b''.join(struct.pack('<20sH', name(title), i) for i, (title, _, _, _) in enumerate(instruments)) + struct.pack('<20sH', name('EOI'), 3))
    pdta += chunk('ibag', b''.join(struct.pack('<HH', i * 3, 0) for i in range(4)))
    pdta += chunk('imod', bytes(10))
    # Release -3600 timecents = 125 ms; sampleID is last in each zone.
    pdta += chunk('igen', b''.join(struct.pack('<HhHhHH', 34, -11000, 38, -3600, 53, i) for i in range(3)) + bytes(4))
    pdta += chunk('shdr', b''.join(headers) + struct.pack('<20sIIIIIBbHH', name('EOS'), position, position, 0, 0, RATE, 0, 0, 0, 1))
    payload = b'sfbk' + chunk('LIST', b'INFO' + info) + chunk('LIST', b'sdta' + chunk('smpl', b''.join(samples))) + chunk('LIST', b'pdta' + pdta)
    (ROOT / 'audio/soundfont/cafe_placeholder.sf3').write_bytes(chunk('RIFF', payload))


if __name__ == '__main__':
    for directory in ['audio/cues', 'audio/soundfont']:
        (ROOT / directory).mkdir(parents=True, exist_ok=True)
    score()
    soundfont()
    print('Authored eight-bar MIDI and three original SF3 instruments.')
