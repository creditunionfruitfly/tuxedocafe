import YAML from 'yaml';

/** File types that need a `<file>.prov.yaml` sidecar wherever they appear under art/, audio/ or public/assets/. */
export const ASSET_EXTENSIONS: ReadonlySet<string> = new Set([
  '.blend', '.fbx', '.obj', '.glb', '.gltf', '.bin', '.ktx2', '.png', '.jpg', '.jpeg', '.webp', '.exr', '.hdr',
  '.psd', '.kra', '.svg', '.wav', '.flac', '.mp3', '.ogg', '.opus', '.webm', '.m4a', '.mid', '.midi', '.sf2', '.sf3',
  '.mp4', '.mov', '.ttf', '.otf', '.woff', '.woff2',
]);

export const AUTHOR_ROLES: ReadonlySet<string> = new Set(['owner', 'master', 'engine', 'artist', 'composer', 'third-party']);

const REQUIRED = ['source', 'tool', 'date', 'license', 'author_role'] as const;

/**
 * Problems with one sidecar's text, or an empty list. Required fields: source,
 * tool, date (YYYY-MM-DD), license (a key in allowlist.yaml) and author_role.
 * Optional: prompt, settings, notes.
 */
export function checkSidecar(text: string, licenses: ReadonlySet<string>): string[] {
  let data: unknown;
  try {
    data = YAML.parse(text);
  } catch (error) {
    return [`is not valid YAML (${(error as Error).message.split('\n')[0]})`];
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return ['must be a YAML mapping'];

  const fields = data as Record<string, unknown>;
  const problems: string[] = [];
  for (const key of REQUIRED) {
    const value = fields[key];
    if (typeof value !== 'string' || value.trim() === '') problems.push(`needs "${key}"`);
  }
  const { date, license, author_role: role } = fields;
  if (typeof date === 'string' && !/^\d{4}-\d{2}-\d{2}$/.test(date)) problems.push('"date" must be YYYY-MM-DD');
  if (typeof license === 'string' && license !== '' && !licenses.has(license)) {
    problems.push(`license "${license}" is not in tools/provenance/allowlist.yaml`);
  }
  if (typeof role === 'string' && role !== '' && !AUTHOR_ROLES.has(role)) {
    problems.push(`author_role must be one of ${[...AUTHOR_ROLES].join(', ')}`);
  }
  return problems;
}
