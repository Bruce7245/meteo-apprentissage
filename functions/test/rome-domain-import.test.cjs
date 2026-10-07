const test = require('node:test');
const assert = require('node:assert/strict');

let domainImport = {};
try {
  domainImport = require('../lib/rome-domain-import.cjs');
} catch {
  domainImport = {};
}

test('buildRomeDomainPublication projects traceable domain documents and metadata', () => {
  assert.equal(typeof domainImport.buildRomeDomainPublication, 'function');

  const result = domainImport.buildRomeDomainPublication({
    domainEntries: [
      {
        domainCode: 'G12',
        domainLabel: "Animation d'activités de loisirs",
        majorDomainCode: 'G',
        majorDomainLabel: 'Hôtellerie-Restauration Tourisme Loisirs et Animation',
        normalizedLabel: 'animation d activites de loisirs',
        romeCodes: ['G1204'],
        source: 'france-travail-rome-main-tree',
        sourceVersion: 'sha256:tree',
        occupationSourceVersion: 'sha256:rome',
      },
    ],
    occupationEntries: [
      {
        romeCode: 'G1204',
        label: 'Educateur sportif / Educatrice sportive',
      },
    ],
    runId: 'rome_domain_2026-10-06_tree',
    sourceName: 'France Travail ROME main tree',
    sourceUrl: 'https://example.test/main-tree.xlsx',
    sourceVersion: 'sha256:tree',
    occupationRunId: 'rome_2026-10-06_rome',
    occupationSourceVersion: 'sha256:rome',
  }, {
    minimumDomains: 1,
  });

  assert.equal(result.documents.length, 1);
  assert.deepEqual(result.documents[0], {
    domainCode: 'G12',
    domainLabel: "Animation d'activités de loisirs",
    majorDomainCode: 'G',
    majorDomainLabel: 'Hôtellerie-Restauration Tourisme Loisirs et Animation',
    normalizedLabel: 'animation d activites de loisirs',
    romeCodes: ['G1204'],
    source: 'france-travail-rome-main-tree',
    sourceVersion: 'sha256:tree',
    occupationSourceVersion: 'sha256:rome',
    importRunId: 'rome_domain_2026-10-06_tree',
    occupationRunId: 'rome_2026-10-06_rome',
    sourceUrl: 'https://example.test/main-tree.xlsx',
    schemaVersion: 'occupationDomainReference.v1',
  });
  assert.equal(result.run.expectedEntries, 1);
  assert.equal(result.meta.entriesCount, 1);
  assert.equal(result.meta.sourceVersion, 'sha256:tree');
  assert.equal(result.meta.occupationRunId, 'rome_2026-10-06_rome');
  assert.equal(result.meta.occupationSourceVersion, 'sha256:rome');
});

test('buildRomeDomainPublication refuses an occupation source version mismatch', () => {
  assert.throws(
    () =>
      domainImport.buildRomeDomainPublication({
        domainEntries: [
          {
            domainCode: 'G12',
            domainLabel: "Animation d'activités de loisirs",
            majorDomainCode: 'G',
            majorDomainLabel: 'Hôtellerie-Restauration Tourisme Loisirs et Animation',
            romeCodes: ['G1204'],
            source: 'france-travail-rome-main-tree',
            sourceVersion: 'sha256:tree',
            occupationSourceVersion: 'sha256:stale',
          },
        ],
        occupationEntries: [{ romeCode: 'G1204', label: 'Educateur sportif' }],
        runId: 'domain-run',
        sourceVersion: 'sha256:tree',
        occupationRunId: 'rome-run',
        occupationSourceVersion: 'sha256:rome',
      }, {
        minimumDomains: 1,
      }),
    /DOMAIN_OCCUPATION_SOURCE_VERSION_MISMATCH/
  );
});

test('buildRomeDomainPublication refuses unmapped current ROME occupations', () => {
  assert.throws(
    () =>
      domainImport.buildRomeDomainPublication({
        domainEntries: [
          {
            domainCode: 'G12',
            domainLabel: "Animation d'activités de loisirs",
            majorDomainCode: 'G',
            majorDomainLabel: 'Hôtellerie-Restauration Tourisme Loisirs et Animation',
            romeCodes: ['G1204'],
            source: 'france-travail-rome-main-tree',
            sourceVersion: 'sha256:tree',
            occupationSourceVersion: 'sha256:rome',
          },
        ],
        occupationEntries: [
          { romeCode: 'G1204', label: 'Educateur sportif' },
          { romeCode: 'D1108', label: 'Vente en alimentation' },
        ],
        runId: 'domain-run',
        sourceVersion: 'sha256:tree',
        occupationRunId: 'rome-run',
        occupationSourceVersion: 'sha256:rome',
      }, {
        minimumDomains: 1,
      }),
    /ROME_DOMAIN_REFERENCE_INVALID/
  );
});
