// Regulatory Knowledge Service — data layer (Stage 2, increment 2).
//
// A real embedded DB (node:sqlite, zero deps) seeded from the git catalogue.
// The DB is the AUTHORING store: versioned CRUD + an audit trail. The git repo
// stays the source of record — `publishToJson()` writes the DB back out to
// data/authorities.json + data/mappings.json so a human commits/PRs the change.
//
// No external dependencies. Node 22.5+ (node:sqlite).

import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
export const DATA_DIR = path.join(ROOT, 'data');

const VALID_JX = new Set(['Federal', 'PR Local', 'NCQA']);
const VALID_STATUS = new Set(['mandate', 'licensed', 'guidance', 'reference', 'retired']);
const VALID_DOMAINS = new Set(['managed-care', 'quality', 'claims', 'encounters', 'membership', 'pharmacy', 'edi', 'privacy-security', 'financial', 'provider', 'member-rights', 'behavioral-health', 'interop', 'contract', 'cms', 'regulator', 'transparency', 'general']);

// Field order mirrors the hand-authored authorities.json so published diffs stay clean.
const AUTH_FIELDS = ['id', 'jurisdiction', 'category', 'citation', 'title', 'title_en', 'title_es', 'summary', 'summary_en', 'summary_es', 'type', 'status', 'url', 'domains'];

export function open(dbPath = path.join(__dirname, 'catalogue.db')) {
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS authorities (
      id TEXT PRIMARY KEY, jurisdiction TEXT, category TEXT, citation TEXT,
      title TEXT, title_en TEXT, title_es TEXT,
      summary TEXT, summary_en TEXT, summary_es TEXT,
      type TEXT, status TEXT, url TEXT, domains TEXT,
      revision INTEGER NOT NULL DEFAULT 1, updated_at TEXT
    );
    CREATE TABLE IF NOT EXISTS mappings (
      artifact TEXT PRIMARY KEY, app TEXT, domain TEXT, authorities TEXT, notes TEXT
    );
    CREATE TABLE IF NOT EXISTS audit (
      seq INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT, actor TEXT, action TEXT,
      entity TEXT, entity_id TEXT, before TEXT, after TEXT
    );
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
  `);
  return db;
}

function nowIso(clock) {
  // clock injected so tests/workflows stay deterministic; defaults to real time.
  return (clock ? clock() : new Date()).toISOString();
}

function rowToAuthority(r) {
  const out = {};
  for (const f of AUTH_FIELDS) {
    if (f === 'domains') { out.domains = r.domains ? JSON.parse(r.domains) : []; continue; }
    if (r[f] !== null && r[f] !== undefined) out[f] = r[f];
  }
  out.revision = r.revision;
  if (r.updated_at) out.updated_at = r.updated_at;
  return out;
}

export function validateAuthority(a, { partial = false } = {}) {
  const errs = [];
  if (!partial || a.id !== undefined) { if (!/^RL-[A-Z]\d{2,}$/.test(a.id || '')) errs.push('id must match RL-[A-Z]NN'); }
  if (a.jurisdiction !== undefined && !VALID_JX.has(a.jurisdiction)) errs.push('bad jurisdiction');
  if (a.status !== undefined && !VALID_STATUS.has(a.status)) errs.push('bad status');
  if (a.domains !== undefined) {
    if (!Array.isArray(a.domains)) errs.push('domains must be an array');
    else for (const d of a.domains) if (!VALID_DOMAINS.has(d)) errs.push('unknown domain: ' + d);
  }
  if (!partial) { if (!a.citation) errs.push('citation required'); if (!a.title) errs.push('title required'); }
  return errs;
}

// ---- seed (idempotent: only when empty, unless force) ----
export function seedFromJson(db, { force = false } = {}) {
  const count = db.prepare('SELECT COUNT(*) n FROM authorities').get().n;
  if (count > 0 && !force) return { seeded: false, authorities: count };
  if (force) { db.exec('DELETE FROM authorities; DELETE FROM mappings;'); }

  const A = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'authorities.json'), 'utf8'));
  const M = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'mappings.json'), 'utf8'));
  const ins = db.prepare(`INSERT INTO authorities
    (id,jurisdiction,category,citation,title,title_en,title_es,summary,summary_en,summary_es,type,status,url,domains,revision,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?)`);
  const ts = nowIso();
  for (const a of A.authorities) {
    ins.run(a.id, a.jurisdiction, a.category ?? null, a.citation, a.title ?? null, a.title_en ?? null, a.title_es ?? null,
      a.summary ?? null, a.summary_en ?? null, a.summary_es ?? null, a.type ?? null, a.status ?? null, a.url ?? null,
      JSON.stringify(a.domains ?? []), ts);
  }
  const insM = db.prepare('INSERT INTO mappings (artifact,app,domain,authorities,notes) VALUES (?,?,?,?,?)');
  for (const m of M.mappings) insM.run(m.artifact, m.app ?? null, m.domain ?? null, JSON.stringify(m.authorities ?? []), m.notes ?? null);

  db.prepare('INSERT OR REPLACE INTO meta (key,value) VALUES (?,?)').run('catalogue_version', A.version || '0.0.0');
  db.prepare('INSERT OR REPLACE INTO meta (key,value) VALUES (?,?)').run('description', A.description || '');
  return { seeded: true, authorities: A.authorities.length, mappings: M.mappings.length };
}

// ---- reads ----
export function listAuthorities(db, { jurisdiction, domain, status, q } = {}) {
  let rows = db.prepare('SELECT * FROM authorities').all().map(rowToAuthority);
  if (jurisdiction) rows = rows.filter(r => r.jurisdiction === jurisdiction);
  if (status) rows = rows.filter(r => r.status === status);
  if (domain) rows = rows.filter(r => (r.domains || []).includes(domain));
  if (q) { const s = q.toLowerCase(); rows = rows.filter(r => ((r.citation || '') + ' ' + (r.title || '') + ' ' + (r.summary || '')).toLowerCase().includes(s)); }
  return rows.sort((a, b) => a.id.localeCompare(b.id));
}
export function getAuthority(db, id) {
  const r = db.prepare('SELECT * FROM authorities WHERE id=?').get(id);
  return r ? rowToAuthority(r) : null;
}
export function listMappings(db) {
  return db.prepare('SELECT * FROM mappings').all().map(m => ({
    artifact: m.artifact, app: m.app, domain: m.domain, authorities: JSON.parse(m.authorities || '[]'), notes: m.notes || undefined,
  }));
}
export function listAudit(db, { limit = 100 } = {}) {
  return db.prepare('SELECT * FROM audit ORDER BY seq DESC LIMIT ?').all(limit).map(a => ({
    seq: a.seq, ts: a.ts, actor: a.actor, action: a.action, entity: a.entity, entity_id: a.entity_id,
    before: a.before ? JSON.parse(a.before) : null, after: a.after ? JSON.parse(a.after) : null,
  }));
}

function audit(db, actor, action, entity, entityId, before, after, clock) {
  db.prepare('INSERT INTO audit (ts,actor,action,entity,entity_id,before,after) VALUES (?,?,?,?,?,?,?)')
    .run(nowIso(clock), actor || 'system', action, entity, entityId, before ? JSON.stringify(before) : null, after ? JSON.stringify(after) : null);
}

// ---- writes (audited, revision-bumped) ----
export function createAuthority(db, obj, { actor = 'system', clock } = {}) {
  const errs = validateAuthority(obj);
  if (errs.length) { const e = new Error('validation: ' + errs.join('; ')); e.code = 'VALIDATION'; throw e; }
  if (getAuthority(db, obj.id)) { const e = new Error('id already exists: ' + obj.id); e.code = 'CONFLICT'; throw e; }
  const ts = nowIso(clock);
  db.prepare(`INSERT INTO authorities
    (id,jurisdiction,category,citation,title,title_en,title_es,summary,summary_en,summary_es,type,status,url,domains,revision,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?)`).run(
    obj.id, obj.jurisdiction, obj.category ?? null, obj.citation, obj.title ?? null, obj.title_en ?? null, obj.title_es ?? null,
    obj.summary ?? null, obj.summary_en ?? null, obj.summary_es ?? null, obj.type ?? null, obj.status ?? 'reference', obj.url ?? null,
    JSON.stringify(obj.domains ?? []), ts);
  const created = getAuthority(db, obj.id);
  audit(db, actor, 'create', 'authority', obj.id, null, created, clock);
  return created;
}

export function updateAuthority(db, id, patch, { actor = 'system', clock } = {}) {
  const before = getAuthority(db, id);
  if (!before) { const e = new Error('not found: ' + id); e.code = 'NOT_FOUND'; throw e; }
  const errs = validateAuthority(patch, { partial: true });
  if (errs.length) { const e = new Error('validation: ' + errs.join('; ')); e.code = 'VALIDATION'; throw e; }
  const cols = [], vals = [];
  for (const f of AUTH_FIELDS) {
    if (f === 'id') continue;
    if (patch[f] === undefined) continue;
    cols.push(`${f}=?`);
    vals.push(f === 'domains' ? JSON.stringify(patch[f]) : patch[f]);
  }
  if (!cols.length) return before;
  cols.push('revision=revision+1', 'updated_at=?'); vals.push(nowIso(clock), id);
  db.prepare(`UPDATE authorities SET ${cols.join(',')} WHERE id=?`).run(...vals);
  const after = getAuthority(db, id);
  audit(db, actor, 'update', 'authority', id, before, after, clock);
  return after;
}

export function retireAuthority(db, id, { actor = 'system', clock } = {}) {
  return updateAuthority(db, id, { status: 'retired' }, { actor, clock });
}

// ---- proposals (Federal Register watcher findings) ----
export function proposals() {
  const p = path.join(DATA_DIR, 'reg-watch', 'latest.json');
  if (!fs.existsSync(p)) return { finding_count: 0, findings: [] };
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

// ---- publish back to the git catalogue (source of record) ----
export function publishToJson(db, { bump, outDir = DATA_DIR } = {}) {
  const rows = listAuthorities(db).sort((a, b) => a.id.localeCompare(b.id));
  const authorities = rows.map(r => {
    const o = {};
    for (const f of AUTH_FIELDS) if (r[f] !== undefined) o[f] = r[f];
    return o;
  });
  const version = bump || db.prepare("SELECT value FROM meta WHERE key='catalogue_version'").get()?.value || '0.0.0';
  const description = db.prepare("SELECT value FROM meta WHERE key='description'").get()?.value || '';
  const authFile = { version, description, authorityCount: authorities.length, authorities };
  const mappings = listMappings(db);
  const mapFile = {
    version,
    description: 'Rule → artifact map. Links a concrete data element / process / EDI transaction used by an Alpine app to the governing authorities (by id in authorities.json).',
    apps: ['hedis', 'ub04-ocr', 'mmis-835', 'shared'],
    mappings: mappings.map(m => { const o = { artifact: m.artifact, app: m.app, domain: m.domain, authorities: m.authorities }; if (m.notes) o.notes = m.notes; return o; }),
  };
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'authorities.json'), JSON.stringify(authFile, null, 2) + '\n');
  fs.writeFileSync(path.join(outDir, 'mappings.json'), JSON.stringify(mapFile, null, 2) + '\n');
  if (bump) db.prepare("INSERT OR REPLACE INTO meta (key,value) VALUES ('catalogue_version',?)").run(bump);
  return { version, authorities: authorities.length, mappings: mappings.length };
}
