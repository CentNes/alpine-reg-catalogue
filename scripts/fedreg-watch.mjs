// Federal Register watcher — Stage 2, increment 1.
//
// Scans the public Federal Register API for final + proposed rules that touch
// the CFR parts cited by this catalogue's Federal authorities, and correlates
// each document back to the affected authority id(s). Emits a structured
// proposals file + a human-readable summary. No dependencies (Node 18+ fetch).
//
// Model: the catalogue git repo stays the source of record; this watcher is the
// automated authoring signal — a scheduled GitHub Action runs it and opens an
// issue so a human triages whether an authority's summary/url/status needs a PR.
//
// Usage:
//   node scripts/fedreg-watch.mjs [--days N] [--out data/reg-watch/latest.json]
//   FEDREG_LOOKBACK_DAYS=30 node scripts/fedreg-watch.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const API = 'https://www.federalregister.gov/api/v1/documents.json';

function arg(flag, fallback) {
  const i = process.argv.indexOf(flag);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const LOOKBACK_DAYS = parseInt(arg('--days', process.env.FEDREG_LOOKBACK_DAYS || '30'), 10);
const OUT = arg('--out', 'data/reg-watch/latest.json');

// --- 1. Extract distinct CFR (title, part) targets from Federal authorities ---
function extractCfr(citation) {
  // Matches "42 CFR Part 438", "45 CFR §164.312", "42 CFR §§438.900–438.930".
  const out = [];
  const re = /(\d{1,2})\s*CFR\s*(?:Part\s*)?§*\s*(\d{1,4})/g;
  let m;
  while ((m = re.exec(citation)) !== null) {
    out.push({ title: parseInt(m[1], 10), part: parseInt(m[2], 10) });
  }
  return out;
}

const authorities = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'data/authorities.json'), 'utf8')
).authorities;

const targets = new Map(); // "title-part" -> { title, part, authorities: [id] }
for (const a of authorities) {
  if (a.jurisdiction !== 'Federal') continue;
  for (const { title, part } of extractCfr(a.citation)) {
    const key = `${title}-${part}`;
    if (!targets.has(key)) targets.set(key, { title, part, authorities: [] });
    if (!targets.get(key).authorities.includes(a.id)) targets.get(key).authorities.push(a.id);
  }
}

const since = new Date(Date.now() - LOOKBACK_DAYS * 86400000).toISOString().slice(0, 10);

// --- 2. Query the Federal Register per CFR target ---
async function queryTarget({ title, part }) {
  const p = new URLSearchParams();
  p.set('per_page', '100');
  p.set('order', 'newest');
  p.set('conditions[cfr][title]', String(title));
  p.set('conditions[cfr][part]', String(part));
  p.set('conditions[publication_date][gte]', since);
  for (const t of ['RULE', 'PRORULE']) p.append('conditions[type][]', t);
  for (const f of ['document_number', 'type', 'title', 'abstract', 'action', 'publication_date', 'html_url', 'cfr_references', 'agency_names']) {
    p.append('fields[]', f);
  }
  const res = await fetch(`${API}?${p.toString()}`, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Federal Register API ${res.status} for ${title} CFR ${part}`);
  const json = await res.json();
  return json.results || [];
}

// --- 3. Correlate documents back to affected authority ids ---
const TYPE_LABEL = { RULE: 'Final rule', PRORULE: 'Proposed rule' };
const findings = new Map(); // document_number -> finding

for (const target of targets.values()) {
  let docs;
  try {
    docs = await queryTarget(target);
  } catch (err) {
    console.error(`  ! ${err.message}`);
    continue;
  }
  for (const d of docs) {
    const refs = (d.cfr_references || []).map((r) => ({ title: r.title, part: r.part }));
    // affected authorities: any target whose (title,part) this doc references
    const affects = new Set();
    for (const r of refs) {
      const t = targets.get(`${r.title}-${r.part}`);
      if (t) t.authorities.forEach((id) => affects.add(id));
    }
    // fall back to the querying target if the doc didn't echo cfr_references
    if (affects.size === 0) target.authorities.forEach((id) => affects.add(id));

    const prev = findings.get(d.document_number);
    const merged = prev ? new Set([...prev.affects, ...affects]) : affects;
    findings.set(d.document_number, {
      document_number: d.document_number,
      type: d.type,
      type_label: TYPE_LABEL[d.type] || d.type,
      title: d.title,
      action: d.action || null,
      abstract: d.abstract ? d.abstract.slice(0, 400) : null,
      publication_date: d.publication_date,
      html_url: d.html_url,
      cfr: refs,
      agencies: d.agency_names || [],
      affects: [...merged].sort(),
    });
  }
}

const list = [...findings.values()].sort((a, b) =>
  b.publication_date.localeCompare(a.publication_date)
);

// --- 4. Emit proposals file + summary ---
const report = {
  generated_at: new Date().toISOString(),
  lookback_days: LOOKBACK_DAYS,
  since,
  cfr_targets: [...targets.values()].sort((a, b) => a.title - b.title || a.part - b.part),
  finding_count: list.length,
  findings: list,
};

const outPath = path.join(ROOT, OUT);
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(report, null, 2) + '\n');

console.log(`Federal Register watch — since ${since} (${LOOKBACK_DAYS}d), ${targets.size} CFR targets`);
console.log(`Targets: ${report.cfr_targets.map((t) => `${t.title} CFR ${t.part}`).join(', ')}`);
console.log(`Findings: ${list.length}`);
for (const f of list.slice(0, 40)) {
  console.log(`  [${f.type_label}] ${f.publication_date} ${f.title.slice(0, 80)}`);
  console.log(`      affects ${f.affects.join(', ')} · ${f.html_url}`);
}
console.log(`\nWrote ${OUT}`);

// exit code 0 always; the workflow decides whether to open an issue based on finding_count
