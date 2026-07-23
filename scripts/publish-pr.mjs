// Publish an approved catalogue edit as a PR (Stage 2, increment 3 — loop closer).
//
// After the Knowledge Service writes the DB back to data/*.json (POST /v1/publish),
// run this to turn that working-tree change into a reviewable PR against the
// catalogue. The git repo stays the source of record; nothing lands without review.
//
//   node scripts/publish-pr.mjs                 # DRY RUN: show branch, diffstat, planned commands
//   node scripts/publish-pr.mjs --open          # create branch, commit data/*.json, push, open PR (needs gh)
//   node scripts/publish-pr.mjs --open --version 1.1.4 --actor nestor
//
// Only ever stages data/authorities.json + data/mappings.json — never `git add -A`.

import { execSync, execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const FILES = ['data/authorities.json', 'data/mappings.json'];

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f, d) => { const i = argv.indexOf(f); return i !== -1 && argv[i + 1] ? argv[i + 1] : d; };
const OPEN = has('--open');
const ACTOR = val('--actor', 'knowledge-service');
const VERSION = val('--version', null);

const git = (c) => execSync(`git ${c}`, { cwd: ROOT, encoding: 'utf8' }).trim();

// 1. Are the catalogue files actually changed?
const changed = git(`status --porcelain -- ${FILES.join(' ')}`).split('\n').filter(Boolean);
if (changed.length === 0) {
  console.log('No catalogue changes in the working tree. Publish from the service first (POST /v1/publish), then re-run.');
  process.exit(0);
}

const stamp = new Date().toISOString().slice(0, 10);
const short = Math.abs([...stamp].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7)).toString(36).slice(0, 4);
const branch = `reg-update/${stamp}-${short}`;
const diffstat = git(`diff --stat -- ${FILES.join(' ')}`);
const title = VERSION ? `catalogue: publish v${VERSION}` : `catalogue: publish regulatory update (${stamp})`;
const body = [
  'Automated publish from the Regulatory Knowledge Service.',
  '',
  '```',
  diffstat,
  '```',
  '',
  `Actor: ${ACTOR}. Review the authority diffs below before merging — the git repo is the source of record.`,
].join('\n');

if (!OPEN) {
  console.log('DRY RUN — no git state changed. Planned:');
  console.log('  branch : ' + branch);
  console.log('  title  : ' + title);
  console.log('  files  :');
  changed.forEach((c) => console.log('    ' + c));
  console.log('\n  diffstat:\n' + diffstat.split('\n').map((l) => '    ' + l).join('\n'));
  console.log('\n  would run:');
  console.log(`    git switch -c ${branch}`);
  console.log(`    git add ${FILES.join(' ')}`);
  console.log(`    git commit -m "${title}"`);
  console.log(`    git push -u origin ${branch}`);
  console.log(`    gh pr create --title "${title}" --body <generated>`);
  console.log('\nRe-run with --open to actually create the PR.');
  process.exit(0);
}

// 2. --open: create the branch, commit only the catalogue files, push, open PR.
const base = git('rev-parse --abbrev-ref HEAD');
console.log(`Opening PR from ${branch} (base ${base})…`);
git(`switch -c ${branch}`);
git(`add ${FILES.join(' ')}`);
execSync(`git commit -m ${JSON.stringify(title)}`, { cwd: ROOT, stdio: 'inherit' });
git(`push -u origin ${branch}`);
try {
  const out = execFileSync('gh', ['pr', 'create', '--base', base, '--head', branch, '--title', title, '--body', body], { cwd: ROOT, encoding: 'utf8' });
  console.log(out.trim());
} finally {
  git(`switch ${base}`);
}
console.log('PR opened. The base branch working tree is restored.');
