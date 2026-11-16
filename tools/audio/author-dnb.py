"""Cat Bongos: original 32-bar liquid DnB at 172 BPM, generated without samples."""
from pathlib import Path
import runpy

PPQ = 480


def author(spec, root, output):
    end = spec['bars'] * 4 * PPQ
    parts = {}

    def at(bar, step):
        return round((bar * 16 + step) * (PPQ // 4))

    def note(channel, bar, step, pitch, length, velocity):
        tick = at(bar, step)
        assert 0 <= tick < end and 0 < velocity < 128
        off = min(tick + length, end)
        parts.setdefault(channel, []).extend(((tick, 2, bytes((144 + channel, pitch, velocity))),
                                              (off, 1, bytes((128 + channel, pitch, 0)))))

    # Gm9, Ebmaj9, Bbmaj7, F6/9, then Cm9, Dm7, Ebmaj9, D7sus.
    harmony = [(0, (3, 7, 10, 14)), (-4, (4, 7, 11, 14)),
               (3, (4, 7, 11, 14)), (-2, (4, 7, 9, 14)),
               (5, (3, 7, 10, 14)), (7, (3, 7, 10, 14)),
               (-4, (4, 7, 11, 14)), (7, (5, 7, 10, 14))]
    # Original two-bar calls and replies, with silence for the percussion.
    phrases = [((2, 7, 3), (7, 10, 2), (11, 14, 3)),
               ((3, 12, 3), (10, 10, 4)),
               ((1, 7, 2), (6, 5, 3), (12, 3, 3)),
               ((5, 2, 4), (12, 0, 3))]
    kicks = ((0, 6, 10), (0, 7, 14), (0, 3, 10), (0, 6, 11))
    ghosts = ((3, 10, 15), (2, 7, 11), (6, 9, 15), (3, 10, 14, 15))
    bongos = (((1, 61, 46), (6, 60, 59), (10, 61, 43), (15, 60, 51)),
              ((2, 60, 48), (7, 61, 55), (9, 60, 40), (14, 61, 61)))

    for bar in range(spec['bars']):
        section = bar // 8
        root_interval, chord = harmony[(bar // 2) % len(harmony)]
        tonic = spec['key'] + root_interval
        # Half-time harmonic rhythm beneath the full-speed break. Bars 16–19
        # pull the kick/snare away for a bongo-led breakdown before the return.
        breakdown = 16 <= bar < 20
        if bar % 2 == 0:
            for interval in (0, chord[0], chord[2]):
                note(4, bar, 0, tonic + interval, 8 * PPQ - 55, 31)
        for step in (0, 10) if bar % 2 == 0 else (6,):
            for interval in (chord[0], chord[2], chord[3]):
                note(1, bar, step, tonic + interval, 530, 42 if step == 0 else 35)
        bass = tonic - 12
        for step, interval, length, velocity in ((0, 0, 620, 75), (7, 0, 390, 64), (12, 7, 350, 61)):
            note(2, bar, step, bass + interval, length, velocity)
        if bar % 4 < 2 or section == 3:
            for step, interval, length in phrases[bar % 4]:
                note(0, bar, step, spec['key'] + 12 + interval, length * 120 - 25, 56 + (bar % 2) * 4)
        if not breakdown:
            for step in kicks[bar % 4]:
                note(9, bar, step, 36, 70, 82 if step == 0 else 65)
            for step in (4, 12):
                note(9, bar, step, 38, 100, 86 if step == 12 else 80)
                note(9, bar, step, 39, 45, 47)
            for step in ghosts[bar % 4]:
                note(9, bar, step, 38, 45, 28 + (step % 3) * 5)
        for step in range(0, 16, 2 if breakdown else 1):
            note(9, bar, step, 70, 32, 24 + (step % 2 == 0) * 13 + (step % 4 == 2) * 7)
        fill = bar % 8 == 7 or bar == 19
        for step, key, velocity in bongos[bar % 2]:
            if fill and step >= 12:
                continue
            note(9, bar, step, key, 80, velocity + (8 if breakdown else 0))
        if fill:
            # Alternating bongo rolls and a cut before the next downbeat.
            for j, step in enumerate((12, 13, 14, 15, 15.5)):
                note(9, bar, step, 60 + j % 2, 45, 44 + j * 5)

    writer = runpy.run_path(str(Path(__file__).with_name('author-extra-cues.py')))['write_cue']
    writer(spec, root, output, parts, end,
           '32-bar 172 BPM liquid DnB in G minor; original chopped kick/snare patterns, ghost strokes, high/low bongos, a percussion breakdown, warm extended chords and a flute hook.',
           tool='tools/audio/author-dnb.py', date='2026-11-16')
