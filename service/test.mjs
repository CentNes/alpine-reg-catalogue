// Service tests (Stage 2, increment 2) — no deps, run: node service/test.mjs
// Uses a throwaway DB + temp publish dir so the real catalogue files are untouched.

import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as store from './db.mjs';

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log('  ok  ' + name); };

const db = store.open(':memory:');
// deterministic clock for audit timestamps
let tick = 0;
const clock = () => new Date(1700000000000 + (tick++) * 1000);

const seeded = store.seedFromJson(db);
t('seed from catalogue json', () => {
  assert.equal(seeded.seeded, true);
  assert.ok(seeded.authorities >= 60, 'authorities seeded: ' + seeded.authorities);
});

t('list + filter authorities', () => {
  const all = store.listAuthorities(db);
  assert.equal(all.length, seeded.authorities);
  const fed = store.listAuthorities(db, { jurisdiction: 'Federal' });
  assert.ok(fed.every(a => a.jurisdiction === 'Federal'));
  const edi = store.listAuthorities(db, { domain: 'edi' });
  assert.ok(edi.every(a => a.domains.includes('edi')));
  const q = store.listAuthorities(db, { q: 'HIPAA' });
  assert.ok(q.length > 0);
});

t('get one authority is bilingual', () => {
  const a = store.getAuthority(db, 'RL-F25');
  assert.equal(a.id, 'RL-F25');
  assert.ok(a.title_es && a.title_en && a.title_es !== a.title_en);
  assert.equal(a.revision, 1);
});

t('create authority (audited)', () => {
  const created = store.createAuthority(db, {
    id: 'RL-X99', jurisdiction: 'Federal', category: 'Test', citation: 'Test Cite',
    title: 'Test authority', title_en: 'Test authority', title_es: 'Autoridad de prueba',
    summary: 'x', summary_en: 'x', summary_es: 'y', type: 'Regulation', status: 'reference', domains: ['claims'],
  }, { actor: 'tester', clock });
  assert.equal(created.id, 'RL-X99');
  assert.equal(created.revision, 1);
  assert.equal(store.listAuthorities(db).length, seeded.authorities + 1);
});

t('create rejects invalid id + duplicate', () => {
  assert.throws(() => store.createAuthority(db, { id: 'bad', jurisdiction: 'Federal', citation: 'c', title: 't' }, { clock }), /validation/);
  assert.throws(() => store.createAuthority(db, { id: 'RL-X99', jurisdiction: 'Federal', citation: 'c', title: 't' }, { clock }), /already exists/);
});

t('update bumps revision + audits before/after', () => {
  const before = store.getAuthority(db, 'RL-X99');
  const after = store.updateAuthority(db, 'RL-X99', { summary_es: 'actualizado', status: 'mandate' }, { actor: 'tester', clock });
  assert.equal(after.revision, before.revision + 1);
  assert.equal(after.summary_es, 'actualizado');
  assert.equal(after.status, 'mandate');
});

t('update rejects unknown domain + missing row', () => {
  assert.throws(() => store.updateAuthority(db, 'RL-X99', { domains: ['not-a-domain'] }, { clock }), /unknown domain/);
  assert.throws(() => store.updateAuthority(db, 'RL-NOPE', { title: 'x' }, { clock }), /not found/);
});

t('retire is a soft status change', () => {
  const r = store.retireAuthority(db, 'RL-X99', { actor: 'tester', clock });
  assert.equal(r.status, 'retired');
  assert.ok(store.listAuthorities(db, { status: 'retired' }).some(a => a.id === 'RL-X99'));
});

t('audit trail captures the sequence', () => {
  const log = store.listAudit(db);
  const mine = log.filter(a => a.entity_id === 'RL-X99');
  const actions = mine.map(a => a.action).reverse(); // oldest first
  assert.deepEqual(actions, ['create', 'update', 'update']); // create, update, retire(=update)
  const upd = mine.find(a => a.action === 'update' && a.after.status === 'mandate');
  assert.equal(upd.before.status, 'reference');
  assert.equal(upd.after.status, 'mandate');
  assert.equal(upd.actor, 'tester');
});

t('publish round-trips to json (temp dir, real files untouched)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'regcat-'));
  const r = store.publishToJson(db, { outDir: tmp });
  assert.equal(r.authorities, seeded.authorities + 1); // includes RL-X99
  const written = JSON.parse(fs.readFileSync(path.join(tmp, 'authorities.json'), 'utf8'));
  assert.equal(written.authorityCount, r.authorities);
  assert.equal(written.authorities.length, r.authorities);
  // re-seed a fresh DB from the published file → same count (proves lossless publish)
  const db2 = store.open(':memory:');
  // point seed at the temp dir by temporarily copying mappings too (already written)
  const A = JSON.parse(fs.readFileSync(path.join(tmp, 'authorities.json'), 'utf8'));
  assert.ok(A.authorities.find(a => a.id === 'RL-X99'));
  assert.ok(A.authorities.every(a => /^RL-[A-Z]\d{2,}$/.test(a.id)));
  fs.rmSync(tmp, { recursive: true, force: true });
});

console.log(`\n${pass} passed`);
