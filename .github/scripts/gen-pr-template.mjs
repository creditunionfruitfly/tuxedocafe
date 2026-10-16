// Generates .github/pull_request_template.md from AGENTS.md: the sign-off
// checklist from the role registry and the checklist from "Definition of done".
//
// Usage: node .github/scripts/gen-pr-template.mjs          (write the template)
//        node .github/scripts/gen-pr-template.mjs --check  (fail if it is stale)
import { readFileSync, writeFileSync } from 'node:fs';
import YAML from 'yaml';

const AGENTS = 'AGENTS.md';
const TEMPLATE = '.github/pull_request_template.md';

function section(markdown, heading) {
  const start = markdown.indexOf(`\n## ${heading}\n`);
  if (start < 0) throw new Error(`${AGENTS} has no "## ${heading}" section.`);
  const rest = markdown.slice(start + heading.length + 5);
  const end = rest.search(/\n## /);
  return end < 0 ? rest : rest.slice(0, end);
}

export function render(agents) {
  const yamlBlock = /```yaml\n([\s\S]*?)```/.exec(section(agents, 'Roles'));
  if (!yamlBlock) throw new Error(`${AGENTS} "## Roles" has no yaml block.`);
  const registry = YAML.parse(yamlBlock[1]);
  const done = section(agents, 'Definition of done')
    .split('\n')
    .filter((line) => line.startsWith('- [ ] '));

  const code = (paths) => paths.map((path) => `\`${path}\``).join(', ');
  const signOffs = [
    ...Object.entries(registry.roles).map(([role, { owns }]) => `- [ ] **${role}**: ${code(owns)}`),
    ...(registry.shared ?? []).map(({ path, approvers }) => `- [ ] **${approvers.join(' + ')}** (shared): ${code([path])}`),
  ];

  return [
    '<!-- Generated from AGENTS.md by .github/scripts/gen-pr-template.mjs. Edit AGENTS.md, then rerun the script. -->',
    '',
    '## Role',
    '',
    '<!-- One of: master, engine, artist, composer -->',
    '',
    '## Task',
    '',
    '<!-- docs/tasks/M<n>-<k>.md -->',
    '',
    '## What changed',
    '',
    '## Budget impact',
    '',
    '<!-- Phone tier: frame time (ms) and download or memory (MB). "None" if nothing at runtime changed. -->',
    '',
    '## Flags',
    '',
    '<!-- Flags added to or removed from data/flags.json, or "none". -->',
    '',
    '## Evidence',
    '',
    '<!-- Screenshots and test output. CI keeps the smoke-test screenshots as a run artifact. -->',
    '',
    '## Sign-off',
    '',
    'The role that owns each touched path ticks its box. Agents share one GitHub account, so GitHub reviews can\'t do this.',
    '',
    ...signOffs,
    '',
    '## Definition of done',
    '',
    ...done,
    '',
  ].join('\n');
}

function main() {
  const expected = render(readFileSync(AGENTS, 'utf8'));
  if (process.argv.includes('--check')) {
    let actual = '';
    try {
      actual = readFileSync(TEMPLATE, 'utf8');
    } catch {
      // Missing counts as stale.
    }
    if (actual !== expected) {
      console.error(`${TEMPLATE} is out of date with ${AGENTS}. Run: node .github/scripts/gen-pr-template.mjs`);
      process.exit(1);
    }
    console.log(`${TEMPLATE} matches ${AGENTS}.`);
    return;
  }
  writeFileSync(TEMPLATE, expected);
  console.log(`Wrote ${TEMPLATE}.`);
}

main();
