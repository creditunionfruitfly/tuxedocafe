// M0 source build; Python 3 and ffmpeg/libvorbis are the only external tools.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

execFileSync('python3', ['tools/audio/author-placeholder.py'], {
  cwd: fileURLToPath(new URL('../../', import.meta.url)),
  stdio: 'inherit',
});
