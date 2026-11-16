"""Original MOS 8580 patches rendered with pyresidfp (reSIDfp, GPL-2.0).

Install tools/audio/requirements.txt into a venv, then run this script.
Emulator source and license: https://github.com/pyresidfp/pyresidfp
Only the generated original samples enter the game. No C64 ROMs or song samples.
"""
from datetime import timedelta
import importlib.util
import math
from pathlib import Path

from pyresidfp import ControlBits, SoundInterfaceDevice, Voice
from pyresidfp.sound_interface_device import ChipModel

spec = importlib.util.spec_from_file_location('aero', Path(__file__).with_name('author-bank.py'))
aero = importlib.util.module_from_spec(spec)
spec.loader.exec_module(aero)


def render(key, waveform, decay=6, pulse=2048, sustain=False, ring=0, sweep=0):
    sid = SoundInterfaceDevice(model=ChipModel.MOS8580, sampling_frequency=aero.RATE)
    sid.Filter_Mode_Vol = 15
    frequency = round(aero.hz(key) * 2**24 / sid.clock_frequency)
    sid.oscillator(Voice.ONE, frequency)
    sid.pulse_width(Voice.ONE, pulse)
    sid.attack_decay(Voice.ONE, decay)
    sid.sustain_release(Voice.ONE, 0xF5 if sustain else 0x05)
    if ring:
        sid.oscillator(Voice.THREE, min(65535, round(frequency * ring)))
        sid.control(Voice.THREE, ControlBits.TRIANGLE)
        waveform |= ControlBits.RING_MOD
    sid.clock(timedelta(milliseconds=100))  # Let chip power-on and volume transients settle.
    sid.control(Voice.ONE, waveform | ControlBits.GATE)
    samples = []
    for frame in range(120):
        if sweep:
            sid.oscillator(Voice.ONE, max(1, round(frequency * (1 + sweep * math.exp(-frame / 3)))))
        samples.extend(sid.clock(timedelta(milliseconds=10)))
    # DC blocker at about 20 Hz, followed by a 3 ms onset ramp.
    values, previous, filtered = [], 0.0, 0.0
    for i, sample in enumerate(samples):
        value = sample / 32768
        filtered = value - previous + .996 * filtered
        previous = value
        values.append(filtered * min(1, i / 96))
    loop = None
    if sustain:
        start = int(aero.RATE * .6)
        period = aero.RATE * 2**24 / (sid.clock_frequency * frequency)
        end = start + round(period * math.floor(aero.RATE * .4 / period))
        # Crossfade the tail into the samples immediately preceding loop start.
        fade = 64
        for i in range(fade):
            mix = (i + 1) / fade
            values[end - fade + i] = values[end - fade + i] * (1 - mix) + values[start - fade + i] * mix
        loop = (start, end)
    else:
        # Settle the final DC removal at silence to avoid an abrupt sample end.
        for i in range(320):
            values[-320 + i] *= 1 - i / 319
    return values, loop


T, P, S, N = ControlBits.TRIANGLE, ControlBits.PULSE, ControlBits.SAWTOOTH, ControlBits.NOISE
# Preserve Aero's exact program numbers, root pitches, attenuation and releases.
PATCHES = [
    dict(waveform=P, decay=8, pulse=1024),       # Glass Rhodes: hollow pulse keys
    dict(waveform=T, decay=7, ring=2),          # Celesta: octave ring bell
    dict(waveform=T, decay=6, ring=2),          # Glockenspiel: metallic ring bell
    dict(waveform=P, decay=6, pulse=512),       # Music box: narrow pulse
    dict(waveform=T, decay=9, ring=2),          # Vibraphone: long bell
    dict(waveform=T, decay=4),                  # Marimba: short triangle
    dict(waveform=P, decay=7, pulse=1280),      # Nylon: plucked pulse
    dict(waveform=T, decay=8),                  # Bass: rounded triangle
    dict(waveform=P, sustain=True, pulse=2048), # Clarinet: square-wave reed
    dict(waveform=T, sustain=True),            # Flute: clean triangle
    dict(waveform=S, sustain=True),            # Pad: sustained saw
]
melodic = []
for preset, patch in zip(aero.MELODIC, PATCHES, strict=True):
    title, bank, program, key, attenuation, release, _ = preset
    melodic.append((title, bank, program, key, attenuation, release,
                    lambda key=key, patch=patch: render(key, **patch)))
drums = [
    ('Soft Kick', 36, lambda: render(31, T, decay=3, sweep=3)),
    ('Brush', 38, lambda: render(55, N, decay=4)),
    ('Finger Snap', 39, lambda: render(88, N, decay=1)),
    ('Shaker', 70, lambda: render(100, N, decay=2)),
    ('High Bongo', 60, lambda: render(59, T, decay=3, sweep=.5)),
    ('Low Bongo', 61, lambda: render(52, T, decay=4, sweep=.5)),
    ('Woodblock', 76, lambda: render(76, T, decay=2, ring=2)),
]
aero.OUT.mkdir(parents=True, exist_ok=True)
aero.soundfont(melodic, drums, 'c64_bank.sf3', 'Tuxedo Cafe C64')
(aero.OUT / 'c64_bank.sf3.prov.yaml').write_text('''source: Original SID patches for Tuxedo Cafe
tool: tools/audio/author-c64.py; pyresidfp 0.17.0 (reSIDfp); ffmpeg libvorbis
date: '2026-11-15'
license: original
author_role: composer
notes: Original MOS 8580 register programming, rendered with the GPL-2.0 emulator at https://github.com/pyresidfp/pyresidfp. No ROMs or borrowed recordings. Samples dedicated to CC0-1.0. Emulator used only during authoring.
''')
print('Authored the C64 SF3 bank with 11 melodic presets and 7 percussion keys.')
