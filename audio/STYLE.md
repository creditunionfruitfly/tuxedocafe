# Audio style v0

The room sounds warm, unhurried and quietly optimistic. Leave space between
phrases for the cats and the café. Original melodies and harmony only; describe
the sound without naming another work, performer or composer.

- **Pulse:** 80–110 BPM, lightly syncopated 4/4 with a soft lounge feel. The first
  cue is 96 BPM, eight bars (20 seconds), with no percussion or hard downbeat.
- **Palette:** rounded electric piano, airy vibraphone and short woody bass.
  Later banks may add nylon guitar, brushed drums, muted brass and small bells,
  but never load instruments a cue does not use.
- **Gloss:** a few high, glassy notes, gentle stereo width and a short diffuse
  room. Avoid bright attacks, constant arpeggios and energy that competes with
  body-language observation. Water and birds are later original café textures.
- **Arrangement:** three MIDI channels, at most six simultaneous held notes in
  the first cue; no sustain pedal. The bank's short releases keep voice tails
  well below the Low phone limit of 24 (Phone 32, Desktop 64).
- **Mix:** music starts at −12 dB bus gain; SFX have a separate bus. Duck music
  4 dB under a purr, with a 100 ms attack and 500 ms release. Respect user volume
  and mute settings. First-gesture AudioContext startup belongs to M3.
- **Delivery:** type-1 MIDI, 480 PPQ, `loopStart` and `loopEnd` markers. The
  prototype bank contains exactly three mono, algorithmically authored samples,
  Vorbis-compressed in SF3; it is a timbral placeholder, not a sampled piano.
- **Loudness:** prepared SFX ≤ −20 LUFS maximum momentary and ≤ −1 dBTP. Music
  fallback target −23 LUFS integrated, ≤ −1 dBTP, with no limiter pumping. M3
  adds automated Opus/AAC fallback delivery and `?listen=` playback.

Regenerate the original MIDI and bank with
`node tools/audio/build-audio.ts` (Python 3 plus ffmpeg/libvorbis), before
`npm run audio:check`. The compressed bank is generated locally and in CI.
This is a deterministic score and waveform recipe; no source samples are used.
The SoundFont sidecar lists every sample and its original license.

Cat sounds are owner-supplied only. `sfx/cat/manifest.json` is the delivery
checklist; pending entries remain silent. Never generate substitute cat audio.

Later optional cues extend the first-cue pulse without altering its recipe:
"Cafe Garage" runs at 130 BPM with a shuffled sixteenth-note two-step, skipping
kicks, clipped offbeat keys and a broken bass line. "Cat Lounge" runs at 92 BPM;
two-bar suspended pads, airy vibraphone, little celesta reflections and a sparse
backbeat make its space-age pop/chillout arc. Both use only the existing bank.
