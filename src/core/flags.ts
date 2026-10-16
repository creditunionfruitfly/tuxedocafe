export function parseFlags(known: readonly string[], query: string, warn = console.warn): Set<string> {
  const result = new Set<string>();
  for (const id of new URLSearchParams(query).get('flags')?.split(',') ?? []) {
    if (!id) continue;
    if (known.includes(id)) result.add(id); else warn(`Unknown feature flag: ${id}`);
  }
  return result;
}
