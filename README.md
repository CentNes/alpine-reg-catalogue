# alpine-reg-catalogue

**Single source of truth for the laws, regulations, and standards that govern
Alpine / First Medical (Plan Vital / PR Medicaid) software.** Every Alpine app —
**HEDIS**, **UB-04 OCR**, **MMIS 835**, and future apps (interoperability,
membership, claims operations) — reads its regulatory context from here instead
of keeping its own divergent copy.

> Why this exists: each app had grown its own list of authorities, so one app
> "knew" rules the others didn't. This catalogue is that shared layer — it's
> cross-cutting platform data, not app data.

## What's here
```
data/authorities.json   65 canonical authorities (federal / PR-local / NCQA), domain-tagged, bilingual (EN/ES)
data/mappings.json      rule → artifact map: which authority governs which data element / process / transaction
schema/authority.schema.json   JSON Schema for one authority
```

### Authority record
```json
{
  "id": "RL-P05",                       // stable canonical id — reference this, never the title
  "jurisdiction": "PR Local",           // Federal | PR Local | NCQA
  "category": "ASES / Plan Vital",
  "citation": "Carta Normativa 21-0217",
  "title": "Required HEDIS measure set (ASES policy letter)",
  "summary": "…",
  "type": "Policy/Guidance",
  "status": "mandate",                  // mandate | licensed | guidance | retired
  "url": "https://docs.pr.gov/…",
  "domains": ["contract","quality","claims","membership","encounters"]
}
```
**ID scheme:** `RL-F##` Federal · `RL-P##` PR Local · `RL-N##` NCQA. IDs are stable — apps reference the id.

**Bilingual (EN/ES):** every authority carries `title_en` / `title_es` and `summary_en` / `summary_es` so bilingual apps (all Alpine apps) render either language from one source. `title` / `summary` remain the canonical fields (English, except PR statutes keep their official Spanish name) for backward-compatible consumers.

**Domains** (an app filters to what it needs, but shares the same source):
`managed-care · quality · claims · encounters · membership · pharmacy · edi ·
privacy-security · financial · provider · member-rights · behavioral-health ·
interop · contract · cms · regulator · transparency`

### Rule → artifact map (`mappings.json`)
The layer that closes the cross-app context gaps. Each entry links a concrete
artifact to its governing authorities — e.g.:
- *837I POA / discharge-status / DRG fields* → `RL-P08` (APR DRG Attestation), `RL-P02` (Contract)
- *835 CARC/RARC + DRG payment* → `RL-F25` (X12/HIPAA), `RL-P08`
- *HEDIS measure set* → `RL-P05` (Carta Normativa 21-0217), `RL-N01` (HEDIS Vol. 2)
- *Encounter submission → MMIS* → `RL-F03` (42 CFR 438.242), `RL-P04` (Reporting Guide)

## How to consume

**Node app** (HEDIS and future JS services): read the JSON directly.
```js
const { authorities } = require('./vendor/alpine-reg-catalogue/data/authorities.json');
const claims = authorities.filter(a => a.domains.includes('claims'));
const byId = Object.fromEntries(authorities.map(a => [a.id, a]));  // byId['RL-P05']
```

**Python app** (UB-04 OCR, MMIS 835 — FastAPI): read the JSON directly.
```python
import json, pathlib
CAT = pathlib.Path("vendor/alpine-reg-catalogue")   # git submodule
authorities = json.loads((CAT/"data/authorities.json").read_text())["authorities"]
claims = [a for a in authorities if "claims" in a["domains"]]
```

**Recommended integration:** add this repo as a **git submodule** under `vendor/`.
Pin a version; bump when the catalogue releases. That keeps every app on the same authoritative set with an explicit,
reviewable update.

## Governance
- **One owner** maintains this catalogue; apps propose additions/edits via PR.
- Every change is versioned (`version` in each JSON + git history).
- Prefer **adding a mapping** over hardcoding a citation in an app.
- Never invent citations/section numbers; include the `url` to the authoritative source.

## Federal Register watcher (Stage 2 · increment 1)

`scripts/fedreg-watch.mjs` scans the public [Federal Register API](https://www.federalregister.gov/developers/documentation/api/v1)
for **final + proposed rules** touching the CFR parts this catalogue's Federal
authorities cite (42 CFR 437/438/441/447, 45 CFR 162/164), and correlates each
document back to the affected authority `id`(s).

```bash
node scripts/fedreg-watch.mjs --days 30   # writes data/reg-watch/latest.json + prints a summary
```

The `.github/workflows/fedreg-watch.yml` Action runs it weekly (and on demand),
uploads the proposals as an artifact, and **opens/updates a single `reg-watch`
triage issue** when there are findings. The repo stays the source of record: a
human turns a finding into a PR against `data/authorities.json` when an
authority's summary/url/status actually needs updating.

> Correlation is part-level: a rule modifying one section of 42 CFR 438 flags
> every authority citing Part 438 (RL-F01…F12). The human triages which are
> genuinely affected. Section-level precision is a later refinement.

## Knowledge Service — API + DB (Stage 2 · increment 2)

`service/` is a dependency-free authoring service: an embedded SQLite store
(`node:sqlite`) seeded from the catalogue JSON, with a JSON HTTP API
(`node:http`). The DB is the editing surface; **the git repo stays the source of
record** — `POST /v1/publish` writes the DB back out to `data/*.json` so a human
commits/PRs the change.

```bash
npm run service        # API on http://localhost:7817 (seeds from data/ on boot)
npm run service:test   # 10 checks: seed, CRUD, validation, audit, publish round-trip
```

| Method | Route | Notes |
|---|---|---|
| GET | `/v1/health` | |
| GET | `/v1/authorities?jurisdiction=&domain=&status=&q=` | filtered list |
| GET | `/v1/authorities/:id` | one (bilingual) |
| POST | `/v1/authorities` | create — `x-actor` header required |
| PATCH | `/v1/authorities/:id` | update fields — bumps `revision`, audited |
| POST | `/v1/authorities/:id/retire` | soft-retire (`status=retired`) |
| GET | `/v1/mappings` · `/v1/audit` | |
| GET | `/v1/proposals` | Federal Register watcher findings |
| POST | `/v1/publish` | write DB → `data/*.json` (source of record) |

Writes require an `x-actor` header, recorded in the audit trail (before/after +
revision). Validation mirrors `scripts/validate.js` (id shape, jurisdiction,
domains, status).

## Admin surface + publish loop (Stage 2 · increment 3)

The service serves an admin UI at **`/admin`** (bilingual EN/ES) with three tabs:
**Autoridades** (searchable list → click to edit an authority, PATCH by `x-actor`),
**Propuestas del watcher** (the Federal Register findings, each with its affected
authority ids as clickable chips that jump straight to the editor), and
**Auditoría** (the change trail). This is the HEDIS Regulatory Monitor pattern
lifted onto the shared API — HEDIS can later point its Monitor at the same
endpoints instead of its own store.

**The loop that closes it:**

```
Federal Register watcher → /v1/proposals → admin review/edit (audited)
   → POST /v1/publish (DB → data/*.json) → node scripts/publish-pr.mjs
   → PR against the catalogue → apps bump the submodule
```

`scripts/publish-pr.mjs` turns the published working-tree change into a PR:

```bash
node scripts/publish-pr.mjs            # dry run: prints branch, diffstat, planned commands
node scripts/publish-pr.mjs --open --version 1.1.4 --actor nestor   # opens the PR via gh
```

It only ever stages `data/authorities.json` + `data/mappings.json` (never
`git add -A`), and restores the base branch afterward. `.gitattributes` pins the
data files to LF so a publish PR shows only the authorities that actually changed.

## Roadmap
- **Stage 1:** shared data package — apps vendor it in. *(done)*
- **Stage 2 — live Regulatory Knowledge Service.** The catalogue git repo stays
  the **source of record**; the service is the automated authoring + monitoring
  layer that publishes to it.
  - **1. Federal Register watcher** — scheduled scan → triage issue. *(done)*
  - **2. API + DB** — SQLite store + JSON API, versioned CRUD, audit, publish. *(done)*
  - **3. Editing UI / Monitor** — admin surface at `/admin` (watcher proposals →
    reviewable edits with audit → publish → catalogue PR). *(done)*

Stage 2 is functionally complete: **watcher → review/edit → publish → PR → apps
bump the submodule.**

## Deploy

The service is containerized (`Dockerfile`, Node 24, no third-party deps). The
SQLite DB is a **cache re-seeded from `data/` on every boot** — git is the source
of record — so the container is effectively stateless and needs **no persistent
volume**; it runs on any container host (Render / Railway / Fly / a VM).

```bash
docker build -t reg-catalogue .
docker run -p 7817:7817 reg-catalogue      # admin UI at :7817/admin
```

Env: `PORT` (default 7817), `DB_PATH` (default `/tmp/catalogue.db`).

Two steps are **operator-owned** (accounts + secrets — not automatable here):
1. **Pick a host** and point it at this repo (any Docker host works; Vercel is a
   poor fit — this is a stateful long-running server, unlike the consumer apps).
2. **Publish token** — opening the catalogue PR (`scripts/publish-pr.mjs --open`)
   needs a GitHub token with `repo` scope. Run it in CI with the built-in
   `GITHUB_TOKEN`, or give the host a `GH_TOKEN` secret. The *running service*
   never needs GitHub write access — only the publish step does.

---
*Sources are public authorities (eCFR, docs.pr.gov, NCQA). This catalogue is a
curated reference, not legal advice — verify against the executed ASES contract
and licensed NCQA materials before relying on it operationally.*
