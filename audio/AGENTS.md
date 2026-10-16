# audio/: Composer conventions

- Layout: `cues/*.mid`, `cues.json` and its schema, `soundfont/` (SF3 sources), `sfx/cafe/`, `sfx/cat/src/` (the owner's ElevenLabs files), `sfx/cat/manifest.json`, and `STYLE.md`.
- Built output goes to `public/assets/audio/` through the audio tools; never hand-edit it.
- MIDI: Standard MIDI File type 1, at most 16 channels, loop start and end markers, only programs that exist in the bank, peak polyphony within 64, 32 and 24 voices by tier.
- The SF3 bank stays at 12 MB at most and holds only the instruments the score uses.
- Cat sounds come from the owner. Import, trim, loop, level and encode them; never generate, replace or re-synthesize one. File names follow README's pattern.
- Every file has a `<file>.prov.yaml`. Cat sounds use license `elevenlabs-paid` with author_role `owner`.
- Level files to −20 LUFS maximum momentary loudness with true peak at most −1 dBTP; the mix itself lives in `cues.json`.
- Mood references describe the sound and never name a composer, game or track.
