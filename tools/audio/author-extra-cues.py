"""Two original, deterministic MIDI arrangements using only the existing café bank.

Run via author-bank.py, or import with runpy for source-MIDI-only regeneration.
No recordings or external MIDI material are used.
"""
from pathlib import Path
import struct

PPQ = 480
BARS = 16
END = BARS * 4 * PPQ


def vlq(value):
    result = [value & 127]
    while value >> 7:
        value >>= 7
        result.insert(0, (value & 127) | 128)
    return bytes(result)


def meta(kind, value):
    data = value.encode() if isinstance(value, str) else value
    return bytes((255, kind)) + vlq(len(data)) + data


def author(spec, root, output):
    garage = spec['arrangement'] == 'uk_garage'
    if spec['arrangement'] not in ('uk_garage', 'space_lounge'):
        raise ValueError('Unknown additional arrangement')
    parts = {}

    def at(bar, sixteenth, swung=False):
        return (bar * 16 + sixteenth) * (PPQ // 4) + (22 if swung and sixteenth % 2 else 0)

    def note(ch, tick, pitch, length, velocity):
        assert 0 <= tick < END and length > 0
        assert 0 <= pitch < 128 and 0 < velocity < 128
        length = min(length, END - tick)
        parts.setdefault(ch, []).extend(((tick, 2, bytes((0x90 + ch, pitch, velocity))),
                                         (tick + length, 1, bytes((0x80 + ch, pitch, 0)))))

    # The two forms have different harmonic arcs and no shared lead phrase.
    garage_form = [(0, (0, 4, 9, 14)), (2, (0, 3, 7, 10)),
                   (5, (0, 4, 7, 11)), (7, (0, 5, 7, 10)),
                   (9, (0, 3, 7, 10)), (5, (0, 4, 9, 14)),
                   (4, (0, 3, 7, 10)), (7, (0, 5, 7, 10)),
                   (0, (0, 4, 9, 14)), (2, (0, 3, 7, 10)),
                   (5, (0, 4, 7, 11)), (9, (0, 3, 7, 10)),
                   (5, (0, 4, 9, 14)), (4, (0, 3, 7, 10)),
                   (2, (0, 3, 7, 10)), (7, (0, 5, 7, 10))]
    # (sixteenth, melodic interval from F4, sixteenths held); irregular
    # entrances leave the offbeat chord replies and two-step snare room.
    garage_lead = [
        [(3, 9, 2), (6, 7, 1), (11, 4, 2)], [(2, 5, 2), (7, 2, 1), (14, 0, 1)],
        [(1, 4, 2), (5, 7, 1), (10, 9, 3)], [(6, 7, 2), (13, 5, 2)],
        [(3, 12, 2), (7, 9, 2), (14, 7, 1)], [(2, 5, 3), (11, 4, 2)],
        [(1, 2, 2), (6, 4, 2), (11, 7, 2)], [(4, 5, 2), (10, 2, 2)],
        [(3, 9, 1), (5, 12, 2), (11, 7, 2)], [(2, 5, 2), (7, 7, 2), (13, 2, 2)],
        [(1, 4, 2), (6, 7, 1), (11, 9, 2)], [(5, 12, 2), (13, 9, 2)],
        [(2, 9, 2), (7, 7, 2), (11, 5, 2)], [(3, 4, 2), (10, 2, 2)],
        [(1, 2, 2), (6, 5, 2), (11, 4, 2)], [(5, 2, 2), (10, 0, 3)],
    ]
    lounge_form = [(0, (0, 4, 7, 11)), (5, (0, 4, 7, 11)),
                   (10, (0, 4, 7, 11)), (2, (0, 3, 7, 10)),
                   (7, (0, 5, 7, 10)), (3, (0, 4, 7, 11)),
                   (9, (0, 3, 7, 10)), (5, (0, 4, 7, 11))]
    lounge_lead = [
        [(0, 7, 5), (10, 11, 4)], [(6, 9, 6)],
        [(2, 7, 4), (11, 5, 3)], [(6, 4, 6)],
        [(1, 9, 5), (10, 7, 4)], [(5, 5, 6)],
        [(2, 4, 4), (11, 2, 3)], [(6, 7, 6)],
        [(0, 11, 5), (10, 14, 4)], [(6, 12, 6)],
        [(2, 9, 4), (11, 7, 3)], [(6, 5, 6)],
        [(1, 7, 5), (10, 4, 4)], [(5, 5, 6)],
        [(2, 9, 4), (11, 7, 3)], [(6, 7, 7)],
    ]

    for bar in range(BARS):
        if garage:
            root_interval, chord = garage_form[bar]
            bass = spec['key'] - 12 + root_interval
            # Broken bass on unexpected sixteenths, with a rest before the
            # backbeat. Chords answer the snare on clipped, swung offbeats.
            bass_pattern = ((0, 3, 7, 10, 14) if bar % 2 == 0 else
                            (0, 6, 9, 14))
            for j, step in enumerate(bass_pattern):
                pitch = bass + (7 if j == 2 else 12 if j == len(bass_pattern) - 1 else 0)
                note(2, at(bar, step, True), pitch, (200 if j % 2 else 245), 61 - j * 3)
            for step in ((2, 6, 11, 14) if bar % 2 == 0 else (3, 7, 10, 15)):
                for interval in (chord[1], chord[2], chord[3]):
                    note(1, at(bar, step, True), spec['key'] + 12 + root_interval + interval,
                         105, 33 + (step in (6, 7)) * 6)
            for step, interval, length in garage_lead[bar]:
                note(0, at(bar, step, True), spec['key'] + 12 + interval,
                     length * 120 - 20, 47 + (bar % 4 == 0) * 4)
            if bar % 2 == 1:
                note(3, at(bar, 13, True), spec['key'] + 36 + chord[2], 175, 27)
            # Skipping kicks and small ghost strokes distinguish the two-step
            # pulse. The bank's brush stands in for a restrained snare.
            for step in ((0, 7, 10) if bar % 2 == 0 else (0, 6, 11, 14)):
                note(9, at(bar, step, True), 36, 65, 48 if step == 0 else 38)
            for step in (4, 12):
                note(9, at(bar, step), 38, 95, 44 if step == 12 else 40)
            for step in (2, 5, 8, 11, 14, 15):
                note(9, at(bar, step, True), 70, 35, 18 + (step % 3) * 4)
            if bar % 4 == 3:
                note(9, at(bar, 11, True), 39, 50, 21)
        else:
            root_interval, chord = lounge_form[bar // 2]
            bass = spec['key'] - 12 + root_interval
            if bar % 2 == 0:
                for interval in (chord[0], chord[1], chord[3]):
                    note(4, at(bar, 0), spec['key'] + root_interval + interval,
                         2 * 16 * 120 - 55, 28)
            for step, pitch, length, vel in ((0, bass, 760, 41),
                                             (10, bass + 7, 290, 33)):
                note(2, at(bar, step), pitch, length, vel)
            for step in ((0, 10) if bar % 2 == 0 else (5, 12)):
                for interval in (chord[1], chord[3]):
                    note(1, at(bar, step), spec['key'] + 12 + root_interval + interval,
                         475 if step == 0 else 355, 29)
            for step, interval, length in lounge_lead[bar]:
                note(0, at(bar, step), spec['key'] + 24 + interval,
                     length * 120 - 30, 42)
            # Celesta pinpricks are separate from the vibraphone's long lines.
            if bar % 2 == 1:
                note(3, at(bar, 2), spec['key'] + 36 + chord[1], 210, 26)
            if bar % 4 in (1, 3):
                for step in (6, 14):
                    note(9, at(bar, step), 70, 38, 13)
            if bar % 4 == 3:
                note(9, at(bar, 12), 38, 85, 19)

    conductor = [(0, 0, meta(3, spec['title'])),
                 (0, 0, meta(81, round(60_000_000 / spec['bpm']).to_bytes(3, 'big'))),
                 (0, 0, meta(88, bytes((4, 2, 24, 8)))),
                 (0, 0, meta(6, 'loopStart')),
                 (END, 0, meta(6, 'loopEnd'))]

    def track(events):
        data, last = bytearray(), 0
        for tick, _, event in sorted(events, key=lambda item: (item[0], item[1])):
            data.extend(vlq(tick - last) + event)
            last = tick
        data.extend(vlq(END - last) + meta(47, b''))
        return b'MTrk' + struct.pack('>I', len(data)) + data

    tracks = [track(conductor)]
    for ch, events in sorted(parts.items()):
        program, volume, pan, reverb, chorus = spec['mix'][str(ch)]
        head = [(0, 0, bytes((0xB0 + ch, control, value))) for control, value in
                ((7, volume), (10, pan), (91, reverb), (93, chorus))]
        if ch != 9:
            head.append((0, 0, bytes((0xC0 + ch, program))))
        tracks.append(track(head + events))
    midi = b'MThd' + struct.pack('>IHHH', 6, 1, len(tracks), PPQ) + b''.join(tracks)
    destination = Path(output) / spec['file']
    destination.write_bytes(midi)
    source = Path(root) / 'audio/cues' / spec['file']
    source.write_bytes(midi)
    notes = ('Swung sixteenth shakers, a displaced two-step kick and brush backbeat, '
             'clipped electric-piano offbeats, answering marimba and a broken bass line.'
             if garage else
             'Slow suspended two-bar pad changes, spacious vibraphone arcs, celesta glints, '
             'soft electric-piano answers and a sparse pulse for an airy space-age lounge.')
    source.with_name(source.name + '.prov.yaml').write_text(
        'source: Original composition for Tuxedo Cafe (' + spec['title'] + ' MIDI source)\n'
        'tool: tools/audio/author-extra-cues.py\n'
        "date: '2026-10-19'\n"
        'license: original\n'
        'author_role: composer\n'
        'notes: ' + notes + ' Deterministic MIDI using the existing original bank; no recordings, borrowed melodies or third-party samples. Dedicated to the public domain under CC0-1.0.\n')
