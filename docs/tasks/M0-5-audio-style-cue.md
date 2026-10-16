# M0-5 Audio style, first cue and manifests

Role: composer
Status: Ready
Budget share: 1% of week A
Model tier: GPT-6 Luna for STYLE.md and the manifest; GPT-6 Sol for audio:check
Depends on: M0-1

## Goal

The sound rules, a first 8-bar MIDI loop with a small placeholder SoundFont, the cue and cat-sound manifests, and an `audio:check` that validates them.

## Read

- AGENTS.md (golden rules 4 and 8) and `audio/AGENTS.md`
- README: Audio and music spec (including "Cat sounds from ElevenLabs"), Technical decisions (D15), Performance budgets

## Files to touch

- `audio/STYLE.md` v0: tempo range, instrument palette, the Frutiger Aero gloss, the mix and loudness targets. Describe the mood in your own words; never name a composer, game or track.
- `audio/cues/cafe_day_a.mid`: an original 8-bar loop. Standard MIDI File type 1, at most 16 channels, loop start and end markers, peak polyphony within 24 voices.
- `audio/soundfont/`: a small placeholder SF3 holding only that cue's instruments. If you cut it from MuseScore General, the license is `MIT` and the sidecar says so.
- `audio/cues.schema.json` and `audio/cues.json`: each cue's MIDI file, loop points, live changes and target voices per tier.
- `audio/sfx/cat/manifest.json`: all 31 cat sounds from README's tables (file stem, seconds, takes, events, caption, loop flag), each `"status": "pending"` until the owner delivers it.
- `tools/audio/audio-check.ts`: replace the stub. Validate `cues.json` against its schema, the MIDI rules, the SF3 size (12 MB at most), and the manifest's file names against README's pattern. Pending cat sounds are warnings until M7.
- `.prov.yaml` sidecars for the MIDI file and the SoundFont.

## Done when

- [ ] `npm run audio:check` passes and reports 31 pending cat sounds
- [ ] The cue plays through spessasynth in a quick local test (live playback in the game is M3)
- [ ] `npm run check` passes, including provenance

## Acceptance

```bash
npm run audio:check && npm run check
```
