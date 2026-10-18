"""Author the original café SoundFont (SF3) and the first style-guide cues into public/assets/audio/.

Every sample is synthesized here (additive, Karplus-Strong and shaped noise); no recordings or
third-party samples. Released as original work under CC0-1.0. Requires ffmpeg with libvorbis.
"""
from array import array
import json
import math
from pathlib import Path
import random
import struct
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'public/assets/audio'
RATE, PPQ, BARS = 32000, 480, 16
END = PPQ * 4 * BARS
rng = random.Random(20261018)


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


def meta(kind, data):
    data = data.encode() if isinstance(data, str) else data
    return bytes([255, kind]) + vlq(len(data)) + data


def hz(key):
    return 440 * 2 ** ((key - 69) / 12)


# ---------- instruments ----------
def decaying(key, seconds, partials, decay, trem=0.0):
    f, out = hz(key), []
    for i in range(int(RATE * seconds)):
        t = i / RATE
        v = sum(a * math.exp(-d * t) * math.sin(math.tau * f * m * t) for m, a, d in partials)
        if trem:
            v *= 1 - trem * (0.5 + 0.5 * math.sin(math.tau * 5.2 * t))
        out.append(v * min(1, t / 0.003) * math.exp(-decay * t))
    return out, None


def plucked(key, seconds, damp, bright):
    period = RATE / hz(key)
    n = int(period)
    frac = period - n
    line = [rng.uniform(-1, 1) for _ in range(n + 1)]
    # Soften the excitation so the nylon and bass stay warm.
    for _ in range(3 - bright):
        line = [(line[i] + line[i - 1]) / 2 for i in range(len(line))]
    out, last = [], 0.0
    for i in range(int(RATE * seconds)):
        a = line[i % len(line)]
        b = line[(i + 1) % len(line)]
        v = damp * ((1 - frac) * a + frac * b + a) / 2
        line[i % len(line)] = v
        last = 0.7 * last + 0.3 * v
        out.append(last)
    return out, None


def sustained(key, seconds, harmonics, breath=0.0, attack=0.06):
    """A looped tone: the loop holds a whole number of cycles, so it repeats without a click."""
    period = RATE / hz(key)
    cycles = max(range(40, 160), key=lambda m: -abs(m * period - round(m * period)))
    length = round(cycles * period)
    f = cycles * RATE / length
    total = int(RATE * seconds)
    out = []
    for i in range(total):
        t = i / RATE
        v = sum(a * math.sin(math.tau * f * m * t + m * 0.7) for m, a in harmonics)
        env = min(1, t / attack)
        if breath and t < attack * 2:
            v += breath * rng.uniform(-1, 1) * (1 - t / (attack * 2))
        out.append(v * env)
    return out, (total - length, total)


def noise_hit(seconds, decay, lowpass, highpass=0.0, tone=None):
    out, lp, hp_prev, hp = [], 0.0, 0.0, 0.0
    for i in range(int(RATE * seconds)):
        t = i / RATE
        x = rng.uniform(-1, 1)
        lp += lowpass * (x - lp)
        hp = lp - hp_prev if highpass else lp
        hp_prev = lp if highpass else 0.0
        v = hp * math.exp(-decay * t)
        if tone:
            f0, f1, td = tone
            v += math.sin(math.tau * (f1 + (f0 - f1) * math.exp(-t * td)) * t) * math.exp(-decay * 0.7 * t)
        out.append(v)
    return out, None


# (title, bank, program, root key, attenuation cB, release s, builder)
MELODIC = [
    ('Glass Rhodes', 0, 4, 60, 30, 0.35, lambda: decaying(60, 2.6, [(1, 1, 1.2), (2, .25, 3), (7, .06, 9)], 0.5)),
    ('Celesta', 0, 8, 72, 40, 0.5, lambda: decaying(72, 2.0, [(1, 1, 1.8), (4, .18, 6), (10, .05, 14)], 0.2)),
    ('Glockenspiel', 0, 9, 84, 60, 0.6, lambda: decaying(84, 2.0, [(1, 1, 1.4), (2.76, .3, 5), (5.4, .12, 9)], 0.2)),
    ('Music Box', 0, 10, 79, 40, 0.4, lambda: decaying(79, 1.8, [(1, 1, 2.4), (3, .2, 7), (5.1, .08, 12)], 0.3)),
    ('Vibraphone', 0, 11, 65, 30, 0.6, lambda: decaying(65, 3.0, [(1, 1, .9), (4, .12, 4)], 0.3, trem=0.25)),
    ('Marimba', 0, 12, 60, 30, 0.2, lambda: decaying(60, 1.2, [(1, 1, 4), (4, .3, 18), (10, .05, 30)], 0.5)),
    ('Nylon', 0, 24, 52, 25, 0.25, lambda: plucked(52, 2.5, 0.996, 1)),
    ('Upright Bass', 0, 32, 36, 20, 0.15, lambda: plucked(36, 2.0, 0.993, 0)),
    ('Clarinet', 0, 71, 60, 60, 0.15, lambda: sustained(60, 1.4, [(1, 1), (3, .45), (5, .22), (7, .1)], breath=.05)),
    ('Flute', 0, 73, 72, 60, 0.2, lambda: sustained(72, 1.4, [(1, 1), (2, .2), (3, .08)], breath=.12)),
    ('Warm Pad', 0, 89, 60, 120, 1.2, lambda: sustained(60, 1.6, [(1, 1), (2, .45), (3, .25), (4, .12), (5, .06)], attack=.5)),
]
# Light kit on bank 128: (title, key, builder).
DRUMS = [
    ('Soft Kick', 36, lambda: noise_hit(.35, 18, .05, tone=(120, 50, 30))),
    ('Brush', 38, lambda: noise_hit(.4, 9, .35)),
    ('Finger Snap', 39, lambda: noise_hit(.12, 55, .9, highpass=1, tone=(2100, 1800, 40))),
    ('Shaker', 70, lambda: noise_hit(.12, 38, .95, highpass=1)),
    ('Woodblock', 76, lambda: decaying(76, .2, [(1, 1, 30), (2.7, .4, 45)], 4)),
]


def encode(samples):
    peak = max(abs(v) for v in samples) or 1
    data = array("f", (0.9 * v / peak for v in samples))
    if sys.byteorder != 'little':
        data.byteswap()
    return subprocess.run(['ffmpeg', '-v', 'error', '-fflags', '+bitexact', '-f', 'f32le', '-ar', str(RATE), '-ac', '1', '-i', 'pipe:0',
                           '-c:a', 'libvorbis', '-q:a', '4', '-flags:a', '+bitexact', '-map_metadata', '-1', '-f', 'ogg', 'pipe:1'],
                          input=data.tobytes(), stdout=subprocess.PIPE, check=True).stdout


def soundfont():
    smpl, shdr, igen, ibag, inst, position = b'', b'', b'', b'', b'', 0
    zones = 0

    def sample(title, built, key):
        nonlocal smpl, shdr, position
        audio, loop = built
        data = encode(audio)
        start, end = loop or (0, len(audio))
        shdr += struct.pack('<20sIIIIIBbHH', name(title), position, position + len(data), start, end, RATE, key, 0, 0, 17)
        smpl += data
        position += len(data)
        return loop is not None

    sample_id = 0
    for i, (title, _, _, key, atten, release, build) in enumerate(MELODIC):
        looped = sample(title, build(), key)
        inst += struct.pack('<20sH', name(title), zones)
        ibag += struct.pack('<HH', len(igen) // 4, 0)
        igen += struct.pack('<Hh', 34, -7200 if title != 'Warm Pad' else -1200)
        igen += struct.pack('<Hh', 38, round(1200 * math.log2(release)))
        igen += struct.pack('<Hh', 48, atten)
        igen += struct.pack('<Hh', 54, 1 if looped else 0)
        igen += struct.pack('<HH', 53, sample_id)
        sample_id += 1
        zones += 1
    inst += struct.pack('<20sH', name('Cafe Kit'), zones)
    for title, key, build in DRUMS:
        sample(title, build(), key)
        ibag += struct.pack('<HH', len(igen) // 4, 0)
        igen += struct.pack('<HH', 43, key | key << 8)
        igen += struct.pack('<Hh', 38, -2400)
        igen += struct.pack('<Hh', 48, 40)
        igen += struct.pack('<HH', 53, sample_id)
        sample_id += 1
        zones += 1
    inst += struct.pack('<20sH', name('EOI'), zones)
    ibag += struct.pack('<HH', len(igen) // 4, 0)
    igen += bytes(4)
    shdr += struct.pack('<20sIIIIIBbHH', name('EOS'), position, position, 0, 0, RATE, 0, 0, 0, 1)
    presets = [(title, bank, program) for title, bank, program, *_ in MELODIC] + [('Cafe Kit', 128, 0)]
    phdr = b''.join(struct.pack('<20sHHHIII', name(t), p, b, i, 0, 0, 0) for i, (t, b, p) in enumerate(presets))
    phdr += struct.pack('<20sHHHIII', name('EOP'), 0, 0, len(presets), 0, 0, 0)
    pbag = b''.join(struct.pack('<HH', i, 0) for i in range(len(presets) + 1))
    pgen = b''.join(struct.pack('<HH', 41, i) for i in range(len(presets))) + bytes(4)
    info = chunk('ifil', struct.pack('<HH', 3, 0))
    for tag, text in [('isng', 'EMU8000'), ('INAM', 'Tuxedo Cafe Bank'), ('ICOP', 'CC0-1.0 original synthesis for Tuxedo Cafe'), ('ISFT', 'tools/audio/author-bank.py')]:
        info += chunk(tag, text.encode() + b'\0')
    pdta = (chunk('phdr', phdr) + chunk('pbag', pbag) + chunk('pmod', bytes(10)) + chunk('pgen', pgen) + chunk('inst', inst)
            + chunk('ibag', ibag) + chunk('imod', bytes(10)) + chunk('igen', igen) + chunk('shdr', shdr))
    payload = b'sfbk' + chunk('LIST', b'INFO' + info) + chunk('LIST', b'sdta' + chunk('smpl', smpl)) + chunk('LIST', b'pdta' + pdta)
    (OUT / 'cafe_bank.sf3').write_bytes(chunk('RIFF', payload))


# ---------- cues ----------
SCALE = [0, 2, 4, 5, 7, 9, 11]
QUALITY = {'maj7': [0, 4, 7, 11], 'maj9': [0, 4, 7, 11, 14], 'maj7#11': [0, 4, 7, 11, 18], 'm7': [0, 3, 7, 10], '7sus': [0, 5, 7, 10], 'm7b5': [0, 3, 6, 10]}
# Imaj7–vi7–ii7–V7sus twice, IVmaj7–iii7–ii7–Imaj9, then the Imaj7–#IVm7b5–IVmaj7#11 lift; V7sus resolves into bar 1.
FORM = [(0, 'maj7'), (9, 'm7'), (2, 'm7'), (7, '7sus')] * 2 + [(5, 'maj7'), (4, 'm7'), (2, 'm7'), (0, 'maj9'), (0, 'maj7'), (6, 'm7b5'), (5, 'maj7#11'), (7, '7sus')]
# The shared motif (eighth offset, scale degree, eighths): 3-5-6-5, a rest, then 3-2 into the next bar.
MOTIF = [(0, 2, 1), (1, 4, 1), (2, 5, 2), (4, 4, 1), (6, 2, 1), (7, 1, 1)]


def chord_tones(key, bar):
    root, quality = FORM[bar]
    return [key + root + i for i in QUALITY[quality]]


def nearest(pitch, tones):
    return min((t + 12 * o for t in tones for o in range(-3, 4)), key=lambda c: abs(c - pitch))


def evening_cue(spec):
    """Two original after-hours forms; the established five-cue recipe stays byte-for-byte intact."""
    reggae = spec['arrangement'] == 'reggae'
    # Relative to G or F. The reggae form moves through IV and vi; the jazz
    # form delays its return to I with a quiet ii–V turnaround.
    form = ([(0, 'maj9'), (5, 'maj7#11'), (2, 'm7'), (7, '7sus'),
             (9, 'm7'), (4, 'm7'), (5, 'maj9'), (7, '7sus'),
             (0, 'maj9'), (5, 'maj7#11'), (2, 'm7'), (4, 'm7'),
             (9, 'm7'), (5, 'maj9'), (2, 'm7'), (7, '7sus')]
            if reggae else
            [(0, 'maj9'), (5, 'maj7#11'), (4, 'm7'), (9, 'm7'),
             (2, 'm7'), (7, '7sus'), (0, 'maj9'), (7, '7sus'),
             (0, 'maj9'), (5, 'maj7#11'), (4, 'm7'), (9, 'm7'),
             (5, 'maj9'), (2, 'm7'), (7, '7sus'), (7, '7sus')])
    # (eighth, pitch relative to tonic at octave 4, duration in eighths).
    lead = (
        [[(1, 4, 2), (4, 7, 1), (6, 9, 1)], [(0, 7, 2), (3, 4, 1), (6, 2, 1)],
         [(1, 0, 1), (3, 2, 1), (5, 4, 2)], [(0, 2, 2), (3, 0, 1), (6, -1, 1)],
         [(1, 4, 1), (3, 7, 2), (6, 9, 1)], [(0, 7, 2), (4, 4, 1)],
         [(1, 5, 2), (4, 7, 1), (6, 9, 1)], [(0, 7, 1), (3, 5, 1), (6, 2, 1)],
         [(1, 4, 2), (4, 7, 1), (6, 11, 1)], [(0, 9, 2), (4, 7, 1)],
         [(1, 5, 1), (3, 4, 1), (5, 2, 2)], [(0, 4, 2), (4, 7, 1)],
         [(1, 7, 2), (4, 4, 1), (6, 2, 1)], [(0, 5, 2), (3, 4, 1)],
         [(1, 2, 1), (3, 4, 1), (5, 5, 2)], [(0, 2, 2), (4, 0, 2)]]
        if reggae else
        [[(0, 4, 2), (3, 7, 1), (5, 11, 2)], [(1, 9, 2), (4, 7, 2)],
         [(0, 7, 1), (2, 9, 2), (5, 7, 2)], [(1, 5, 2), (4, 4, 1), (6, 2, 1)],
         [(0, 2, 2), (3, 5, 1), (5, 9, 2)], [(1, 7, 2), (4, 5, 2)],
         [(0, 4, 1), (2, 7, 2), (5, 11, 2)], [(1, 7, 2), (5, 4, 1)],
         [(0, 4, 2), (3, 7, 1), (5, 12, 2)], [(1, 11, 2), (4, 9, 2)],
         [(0, 7, 1), (2, 9, 2), (5, 7, 2)], [(1, 5, 2), (4, 4, 1)],
         [(0, 2, 2), (3, 5, 1), (5, 9, 2)], [(1, 7, 2), (4, 5, 1), (6, 2, 1)],
         [(0, 5, 2), (3, 4, 1), (5, 2, 2)], [(1, 4, 2), (4, 0, 2)]])
    parts = {}

    def at(bar, eighth):
        beat, half = divmod(eighth, 2)
        return (bar * 4 + beat) * PPQ + (round(PPQ * (0.51 if reggae else 0.54)) if half else 0)

    def note(ch, tick, pitch, length, velocity):
        parts.setdefault(ch, []).extend([(tick, 2, bytes([144 + ch, pitch, velocity])),
                                         (tick + length, 1, bytes([128 + ch, pitch, 0]))])

    for bar, (root, quality) in enumerate(form):
        tones = QUALITY[quality]
        base = spec['key'] + root
        bass = spec['key'] - 12 + root
        if bass < 40:
            bass += 12
        for eighth, degree, length in lead[bar]:
            note(0, at(bar, eighth), spec['key'] + 12 + degree,
                 length * PPQ // 2 - 35, (54 if reggae else 48) + (bar % 4 == 0) * 3)
        if reggae:
            # Clipped nylon upstrokes exclusively between beats. The Rhodes
            # answers sparsely; neither instrument masks the one-drop.
            shell = list(dict.fromkeys(base + tones[i] for i in (1, 3, -1)))
            for eighth in (1, 3, 5, 7):
                for pitch in shell:
                    note(1, at(bar, eighth), pitch, 125, 39 + (eighth == 5) * 4)
            for eighth in (0, 4) if bar % 2 == 0 else (2, 6):
                for pitch in (base + tones[1] + 12, base + tones[3]):
                    note(3, at(bar, eighth), pitch, 195, 29)
            fifth = bass + 7 if bass + 7 <= 53 else bass - 5
            for eighth, pitch, length, vel in [(0, bass, 440, 62), (3, fifth, 195, 48),
                                                (4, bass + 12, 360, 56), (7, fifth, 155, 43)]:
                note(2, at(bar, eighth), pitch, length, vel)
            note(9, at(bar, 4), 36, 110, 48)
            note(9, at(bar, 4), 38, 125, 39)
            for eighth in range(8):
                note(9, at(bar, eighth), 70, 38, 17 + (eighth % 2) * 7)
            if bar % 4 == 3:
                note(9, at(bar, 7), 76, 55, 22)
        else:
            shell = list(dict.fromkeys(base + tones[i] for i in (1, 2, 3, -1)))
            for eighth, length, vel in [(0, 650, 34), (5, 400, 31)]:
                for pitch in shell:
                    note(1, at(bar, eighth), pitch, length, vel)
            fifth = bass + 7 if bass + 7 <= 53 else bass - 5
            for eighth, pitch, length, vel in [(0, bass, 710, 51), (3, fifth, 260, 40),
                                                (6, bass + 12, 275, 41)]:
                note(2, at(bar, eighth), pitch, length, vel)
            for eighth in (2, 6):
                note(9, at(bar, eighth), 38, 125, 26)
            for eighth in (0, 4):
                note(9, at(bar, eighth), 36, 95, 24)
            for eighth in (1, 3, 5, 7):
                note(9, at(bar, eighth), 70, 40, 16)

    conductor = [(0, 0, meta(3, spec['title'])),
                 (0, 0, meta(81, round(60_000_000 / spec['bpm']).to_bytes(3, 'big'))),
                 (0, 0, meta(88, bytes([4, 2, 24, 8]))),
                 (0, 0, meta(6, 'loopStart')), (END, 0, meta(6, 'loopEnd'))]
    tracks = [conductor]
    for ch, events in sorted(parts.items()):
        program, volume, pan, reverb, chorus = spec['mix'][str(ch)]
        head = [(0, 0, bytes([176 + ch, control, value])) for control, value in
                [(7, volume), (10, pan), (91, reverb), (93, chorus)]]
        if ch != 9:
            head.append((0, 0, bytes([192 + ch, program])))
        tracks.append(head + events)

    def encode_track(events):
        data, last = b'', 0
        for tick, _, event in sorted(events, key=lambda e: (e[0], e[1])):
            data += vlq(tick - last) + event
            last = tick
        data += vlq(max(0, END - last)) + meta(47, b'')
        return b'MTrk' + struct.pack('>I', len(data)) + data

    midi = b'MThd' + struct.pack('>IHHH', 6, 1, len(tracks), PPQ) + b''.join(map(encode_track, tracks))
    (OUT / spec['file']).write_bytes(midi)
    source = ROOT / 'audio/cues' / spec['file']
    source.write_bytes(midi)
    source.with_name(source.name + '.prov.yaml').write_text(PROV.format(what=spec['title'] + ' MIDI source'))


def cue(spec):
    if spec.get('arrangement') in ('reggae', 'late_jazz'):
        evening_cue(spec)
        return
    key, swing = spec['key'], spec['swing']
    def at(bar, eighth):
        beat, half = divmod(eighth, 2)
        return bar * 4 * PPQ + beat * PPQ + (round(PPQ * swing) if half else 0)
    parts = {}
    def note(ch, tick, pitch, length, velocity):
        parts.setdefault(ch, []).extend([(tick, 2, bytes([144 + ch, pitch, velocity])), (tick + length, 1, bytes([128 + ch, pitch, 0]))])
    for bar in range(BARS):
        tones, phrase = chord_tones(key, bar), bar // 2
        lift = 2 if phrase % 4 == 3 else 0
        if bar % 2 == 0 or spec.get('busyLead'):
            for eighth, degree, length in MOTIF:
                d = degree + lift
                pitch = key + 12 * spec['leadOctave'] + SCALE[d % 7] + 12 * (d // 7)
                if length > 1:
                    pitch = nearest(pitch, tones)
                note(0, at(bar, eighth), pitch, length * PPQ // 2 - 30, spec['leadVel'])
        else:
            target = key + 12 * spec['leadOctave'] + (SCALE[(phrase % 3) * 2 % 7])
            note(0, at(bar, 0), nearest(target, tones), PPQ * 2, spec['leadVel'] - 6)
        voicing = sorted(nearest(t + 12, [t]) for t in tones)
        voicing = [p if p >= 55 else p + 12 for p in voicing]
        if spec['comp'] == 'offbeat':
            for eighth in [1, 4, 7]:
                for p in voicing:
                    note(1, at(bar, eighth), p, PPQ // 2, spec['chordVel'])
        elif spec['comp'] == 'bossa':
            # Bossa guitar: syncopated chord hits that answer across each two-bar cell.
            for eighth in ([0, 3, 6] if bar % 2 == 0 else [2, 5]):
                for p in voicing:
                    note(1, at(bar, eighth), p, PPQ * 3 // 4, spec['chordVel'])
        elif spec['comp'] == 'samba':
            # Partido-alto style comping: short, offbeat-heavy stabs.
            for eighth in [1, 3, 4, 6]:
                for p in voicing:
                    note(1, at(bar, eighth), p, PPQ // 3, spec['chordVel'] + (6 if eighth == 3 else 0))
        elif spec['comp'] == 'arp':
            for i in range(8):
                note(1, at(bar, i), voicing[i % len(voicing)], PPQ, spec['chordVel'])
        else:
            for p in voicing:
                note(1, at(bar, 0), p, PPQ * 4 - 40, spec['chordVel'])
        bass = key - 12 + FORM[bar][0]
        bass = bass if bass >= 36 else bass + 12
        if spec['bass'] == 'hop':
            note(2, at(bar, 0), bass, PPQ - 60, 58); note(2, at(bar, 3), bass + 7, PPQ // 2, 46); note(2, at(bar, 4), bass + 7, PPQ - 60, 54)
            note(2, at(bar, 7), bass + 12, PPQ // 3, 42)
        elif spec['bass'] == 'bossa':
            fifth = bass + 7 if bass + 7 <= 52 else bass - 5
            note(2, at(bar, 0), bass, PPQ * 3 // 2 - 40, 56); note(2, at(bar, 3), fifth, PPQ * 5 // 2 - 40, 50)
        elif spec['bass'] == 'surdo':
            note(2, at(bar, 0), bass, PPQ // 2, 46); note(2, at(bar, 3), bass - 5, PPQ // 4, 38); note(2, at(bar, 4), bass, PPQ - 40, 62)
        else:
            note(2, at(bar, 0), bass, PPQ * 4 - 60, 50)
        if spec.get('pad'):
            for p in voicing[:3]:
                note(4, at(bar, 0), p - 12, PPQ * 4, 30)
        if spec.get('sparkle') and bar % 4 == 2:
            for i, p in enumerate(sorted(tones)[:4]):
                note(3, at(bar, 4 + i), p + 24, PPQ // 2, 40)
        drums = spec.get('drums')
        if drums == 'bossa':
            for eighth in ([0, 3, 6] if bar % 2 == 0 else [2, 4]):
                note(9, at(bar, eighth), 76, 50, 34)
            for eighth in range(8):
                note(9, at(bar, eighth), 70, 40, 18 + 6 * (eighth % 2))
            for eighth in [0, 4]:
                note(9, at(bar, eighth), 36, 120, 30)
        elif drums == 'samba':
            for eighth in range(8):
                note(9, at(bar, eighth), 70, 40, 26 + 10 * (eighth % 2))
            for eighth in [0, 2, 3, 5, 7]:
                note(9, at(bar, eighth), 76, 40, 36)
            for eighth in [2, 6]:
                note(9, at(bar, eighth), 36, 120, 44)
            note(9, at(bar, 4), 38, 120, 22)
        elif drums:
            for beat in [1, 3]:
                note(9, at(bar, beat * 2), 39, 60, 44)
            for eighth in range(8):
                note(9, at(bar, eighth), 70, 40, 22 + 8 * (eighth % 2))
    if spec.get('jingle'):
        for i, p in enumerate([key + 31, key + 36, key + 40]):
            note(3, i * PPQ // 4, p, PPQ // 2, 34)
    conductor = [(0, 0, meta(3, spec['title'])), (0, 0, meta(81, round(60_000_000 / spec['bpm']).to_bytes(3, 'big'))),
                 (0, 0, meta(88, bytes([4, 2, 24, 8]))), (0, 0, meta(6, 'loopStart')), (END, 0, meta(6, 'loopEnd'))]
    tracks = [conductor]
    for ch, events in sorted(parts.items()):
        program, volume, pan, reverb, chorus = spec['mix'][str(ch)]
        head = [(0, 0, bytes([176 + ch, 7, volume])), (0, 0, bytes([176 + ch, 10, pan])), (0, 0, bytes([176 + ch, 91, reverb])), (0, 0, bytes([176 + ch, 93, chorus]))]
        if ch != 9:
            head.append((0, 0, bytes([192 + ch, program])))
        tracks.append(head + events)
    def encode_track(events):
        data, last = b'', 0
        for tick, _, event in sorted(events, key=lambda e: (e[0], e[1])):
            data += vlq(tick - last) + event
            last = tick
        data += vlq(max(0, END - last)) + meta(47, b'')
        return b'MTrk' + struct.pack('>I', len(data)) + data
    (OUT / spec['file']).write_bytes(b'MThd' + struct.pack('>IHHH', 6, 1, len(tracks), PPQ) + b''.join(map(encode_track, tracks)))


PROV = """source: Original synthesis and composition for Tuxedo Cafe ({what})
tool: tools/audio/author-bank.py; ffmpeg libvorbis
date: '2026-10-18'
license: original
author_role: composer
notes: Generated at build time; no recordings, third-party samples, melodies or progressions. Dedicated to the public domain under CC0-1.0.
"""

if __name__ == '__main__':
    OUT.mkdir(parents=True, exist_ok=True)
    soundfont()
    (OUT / 'cafe_bank.sf3.prov.yaml').write_text(PROV.format(what='SF3 bank'))
    for spec in json.loads((ROOT / 'audio/music.json').read_text())['tracks']:
        cue(spec)
        (OUT / (spec['file'] + '.prov.yaml')).write_text(PROV.format(what=spec['title']))
    print(f'Authored the café bank and {len(json.loads((ROOT / "audio/music.json").read_text())["tracks"])} cues into public/assets/audio/.')
