// npm run audio:check: validates MIDI cues, the SoundFont and the cat-sound manifest,
// and renders Opus and AAC fallbacks. Stub from task M0-1; the Composer replaces it in M0-4.
import { existsSync, readFileSync } from 'node:fs';

const problems: string[] = [];
for (const file of ['audio/cues.json', 'audio/sfx/cat/manifest.json']) {
  if (!existsSync(file)) {
    console.log(`${file}: not created yet (task M0-4).`);
    continue;
  }
  try {
    JSON.parse(readFileSync(file, 'utf8'));
    console.log(`${file}: valid JSON.`);
  } catch (error) {
    problems.push(`${file}: ${(error as Error).message}`);
  }
}

if (problems.length > 0) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log('Audio check passed (stub: no MIDI, SoundFont or render checks yet).');
