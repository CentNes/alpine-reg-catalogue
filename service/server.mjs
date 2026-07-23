// Regulatory Knowledge Service — HTTP API (Stage 2, increment 2).
//
// Dependency-free JSON API (node:http) over the SQLite authoring store. Reads
// are open; writes require an `x-actor` header (recorded in the audit trail).
// The service publishes to the git catalogue via POST /v1/publish.
//
//   node service/server.mjs            # listens on :7817 (or $PORT)
//
// Routes:
//   GET  /v1/health
//   GET  /v1/authorities            ?jurisdiction=&domain=&status=&q=
//   GET  /v1/authorities/:id
//   POST /v1/authorities            (create; x-actor)
//   PATCH/v1/authorities/:id        (update fields; x-actor)
//   POST /v1/authorities/:id/retire (soft-retire; x-actor)
//   GET  /v1/mappings
//   GET  /v1/proposals              (Federal Register watcher findings)
//   GET  /v1/audit                  ?limit=
//   POST /v1/publish                (write DB -> data/*.json; body {bump?})

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as store from './db.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 7817;
const db = store.open(process.env.DB_PATH || undefined);
const seed = store.seedFromJson(db);
if (seed.seeded) console.error(`[service] seeded ${seed.authorities} authorities, ${seed.mappings} mappings`);

function send(res, code, body) {
  const s = JSON.stringify(body, null, 2);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(s) });
  res.end(s);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let b = '';
    req.on('data', (c) => { b += c; if (b.length > 1e6) reject(new Error('body too large')); });
    req.on('end', () => { try { resolve(b ? JSON.parse(b) : {}); } catch (e) { reject(new Error('invalid JSON body')); } });
  });
}
const codeFor = { VALIDATION: 400, CONFLICT: 409, NOT_FOUND: 404 };

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const parts = url.pathname.split('/').filter(Boolean); // ['v1','authorities',':id']
    const actor = req.headers['x-actor'];

    // Admin UI (static)
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/admin')) {
      const html = fs.readFileSync(path.join(__dirname, 'public', 'admin.html'));
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(html);
    }

    if (req.method === 'GET' && url.pathname === '/v1/health') return send(res, 200, { ok: true, service: 'reg-catalogue', authorities: store.listAuthorities(db).length });

    if (parts[0] === 'v1' && parts[1] === 'authorities') {
      const id = parts[2];
      if (req.method === 'GET' && !id) {
        const q = url.searchParams;
        return send(res, 200, { items: store.listAuthorities(db, { jurisdiction: q.get('jurisdiction'), domain: q.get('domain'), status: q.get('status'), q: q.get('q') }) });
      }
      if (req.method === 'GET' && id) { const a = store.getAuthority(db, id); return a ? send(res, 200, a) : send(res, 404, { error: 'not found' }); }
      if (req.method === 'POST' && !id) { if (!actor) return send(res, 401, { error: 'x-actor header required for writes' }); const a = store.createAuthority(db, await readBody(req), { actor }); return send(res, 201, a); }
      if (req.method === 'PATCH' && id) { if (!actor) return send(res, 401, { error: 'x-actor header required for writes' }); const a = store.updateAuthority(db, id, await readBody(req), { actor }); return send(res, 200, a); }
      if (req.method === 'POST' && id && parts[3] === 'retire') { if (!actor) return send(res, 401, { error: 'x-actor header required for writes' }); const a = store.retireAuthority(db, id, { actor }); return send(res, 200, a); }
    }

    if (req.method === 'GET' && url.pathname === '/v1/mappings') return send(res, 200, { items: store.listMappings(db) });
    if (req.method === 'GET' && url.pathname === '/v1/proposals') return send(res, 200, store.proposals());
    if (req.method === 'GET' && url.pathname === '/v1/audit') return send(res, 200, { items: store.listAudit(db, { limit: parseInt(url.searchParams.get('limit') || '100', 10) }) });
    if (req.method === 'POST' && url.pathname === '/v1/publish') { if (!actor) return send(res, 401, { error: 'x-actor header required' }); const body = await readBody(req); const r = store.publishToJson(db, { bump: body.bump }); return send(res, 200, { published: true, ...r }); }

    return send(res, 404, { error: 'no route', method: req.method, path: url.pathname });
  } catch (err) {
    return send(res, codeFor[err.code] || 500, { error: err.message, code: err.code || 'INTERNAL' });
  }
});

// Export for tests; only listen when run directly.
export { server, db, store };
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('server.mjs')) {
  server.listen(PORT, () => console.error(`[service] reg-catalogue API on http://localhost:${PORT}`));
}
