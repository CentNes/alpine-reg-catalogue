'use strict';
// Lightweight integrity check — no deps. Fails non-zero on any problem.
const A = require('../data/authorities.json');
const M = require('../data/mappings.json');
const DOMAINS = new Set(['managed-care','quality','claims','encounters','membership','pharmacy','edi','privacy-security','financial','provider','member-rights','behavioral-health','interop','contract','cms','regulator','transparency','general']);
const JX = new Set(['Federal','PR Local','NCQA']);
const errors = [];
const ids = new Set();
for (const a of A.authorities) {
  if (!/^RL-[A-Z]\d{2,}$/.test(a.id)) errors.push('bad id: ' + a.id);
  if (ids.has(a.id)) errors.push('duplicate id: ' + a.id);
  ids.add(a.id);
  if (!JX.has(a.jurisdiction)) errors.push(a.id + ' bad jurisdiction: ' + a.jurisdiction);
  for (const d of (a.domains || [])) if (!DOMAINS.has(d)) errors.push(a.id + ' unknown domain: ' + d);
  if (!a.title || !a.citation) errors.push(a.id + ' missing title/citation');
}
for (const m of M.mappings) {
  for (const id of (m.authorities || [])) if (!ids.has(id)) errors.push('mapping "' + m.artifact + '" references missing authority ' + id);
}
if (errors.length) { console.error('INVALID:\n' + errors.map(e => '  - ' + e).join('\n')); process.exit(1); }
console.log('OK — ' + A.authorities.length + ' authorities, ' + M.mappings.length + ' mappings, all references resolve.');
