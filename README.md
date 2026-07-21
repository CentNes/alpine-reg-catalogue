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
data/authorities.json   62 canonical authorities (federal / PR-local / NCQA), domain-tagged, bilingual (EN/ES)
data/mappings.json      rule → artifact map: which authority governs which data element / process / transaction
schema/authority.schema.json   JSON Schema for one authority
index.js                Node helper (byId, byDomain, byJurisdiction, mappingsForApp, authoritiesForArtifact)
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

**Node app** (HEDIS and future JS services):
```bash
npm install github:CentNes/alpine-reg-catalogue   # or add as a git submodule
```
```js
const reg = require('@alpine/reg-catalogue');
reg.byDomain('claims');                    // authorities relevant to claims
reg.byId('RL-P05');                        // Carta Normativa 21-0217
reg.mappingsForApp('ub04-ocr');            // this app's rule→artifact map (+ shared)
reg.authoritiesForArtifact('POA');         // governing authorities for a POA field
```

**Python app** (UB-04 OCR, MMIS 835 — FastAPI): read the JSON directly.
```python
import json, pathlib
CAT = pathlib.Path("vendor/alpine-reg-catalogue")   # git submodule
authorities = json.loads((CAT/"data/authorities.json").read_text())["authorities"]
claims = [a for a in authorities if "claims" in a["domains"]]
```

**Recommended integration:** add this repo as a **git submodule** under `vendor/`
(or install as an npm dependency for JS). Pin a version; bump when the catalogue
releases. That keeps every app on the same authoritative set with an explicit,
reviewable update.

## Governance
- **One owner** maintains this catalogue; apps propose additions/edits via PR.
- Every change is versioned (`version` in each JSON + git history).
- Prefer **adding a mapping** over hardcoding a citation in an app.
- Never invent citations/section numbers; include the `url` to the authoritative source.

## Roadmap
- **Stage 1 (this repo):** shared data package — apps vendor it in. *(current)*
- **Stage 2 (later):** promote to a live **Regulatory Knowledge Service** (API +
  DB) with editing, an automatic **Federal Register** watcher, and audit — the
  HEDIS app's Regulatory Library / Regulatory Monitor is the working v0 of that
  service and would be lifted here when the platform consolidates.

---
*Sources are public authorities (eCFR, docs.pr.gov, NCQA). This catalogue is a
curated reference, not legal advice — verify against the executed ASES contract
and licensed NCQA materials before relying on it operationally.*
