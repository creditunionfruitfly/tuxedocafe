/** Build log with elapsed time; quiet unless CAT_VERBOSE is set or the message is a summary. */
const start = performance.now();
export function log(message: string, always = false) {
  if (always || process.env.CAT_VERBOSE) console.log(`[cat ${((performance.now() - start) / 1000).toFixed(1)}s] ${message}`);
}
