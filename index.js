'use strict';
/**
 * @alpine/reg-catalogue — shared regulatory catalogue for Alpine / First Medical
 * (Plan Vital / PR Medicaid) apps. Node consumers use this helper; other stacks
 * read data/authorities.json and data/mappings.json directly (plain JSON).
 */
const authoritiesDoc = require('./data/authorities.json');
const mappingsDoc = require('./data/mappings.json');

const authorities = authoritiesDoc.authorities;
const mappings = mappingsDoc.mappings;

const byId = (id) => authorities.find(a => a.id === id);
const byIds = (ids) => (ids || []).map(byId).filter(Boolean);

/** Authorities tagged with a given operational domain (e.g. 'claims', 'quality'). */
const byDomain = (domain) => authorities.filter(a => (a.domains || []).includes(domain));

/** Authorities for a jurisdiction ('Federal' | 'PR Local' | 'NCQA'). */
const byJurisdiction = (j) => authorities.filter(a => a.jurisdiction === j);

/** Rule→artifact mappings for an app ('hedis' | 'ub04-ocr' | 'mmis-835' | 'shared'). */
const mappingsForApp = (app) => mappings.filter(m => m.app === app || m.app === 'shared');

/** Resolve an artifact's governing authorities (full objects). */
const authoritiesForArtifact = (artifactSubstr) => {
  const m = mappings.find(x => x.artifact.toLowerCase().includes(String(artifactSubstr).toLowerCase()));
  return m ? { mapping: m, authorities: byIds(m.authorities) } : null;
};

module.exports = {
  version: authoritiesDoc.version,
  authorities, mappings,
  byId, byIds, byDomain, byJurisdiction, mappingsForApp, authoritiesForArtifact
};
