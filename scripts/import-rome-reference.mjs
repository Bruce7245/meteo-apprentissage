import crypto from 'node:crypto';
import { getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import AdmZip from 'adm-zip';
import XLSX from 'xlsx';
import romeOpenData from '../functions/lib/rome-open-data.cjs';
import romeDomainImport from '../functions/lib/rome-domain-import.cjs';

const {
  extractRomeReferenceEntries,
  extractRomeDomainReferenceEntries,
  validateRomeReference,
  validateRomeDomainReference,
} = romeOpenData;

const {
  buildRomeDomainPublication,
} = romeDomainImport;

const SOURCES = [
  {
    name: 'data.gouv JSON ROME',
    source: 'data-gouv-rome',
    url: 'https://www.data.gouv.fr/api/1/datasets/r/1c893376-8476-4262-9a0e-8df519883e1e',
  },
  {
    name: 'France Travail JSON ROME',
    source: 'france-travail-rome',
    url: 'https://api.francetravail.fr/api-nomenclatureemploi/v1/open-data/json',
  },
  {
    name: 'data.gouv CSV ROME',
    source: 'data-gouv-rome',
    url: 'https://www.data.gouv.fr/api/1/datasets/r/8cf674b6-ef21-446a-8190-178e2defd6fc',
  },
  {
    name: 'France Travail CSV ROME',
    source: 'france-travail-rome',
    url: 'https://api.francetravail.fr/api-nomenclatureemploi/v1/open-data/csv',
  },
];

const DOMAIN_SOURCE = {
  name: 'France Travail ROME main tree',
  source: 'france-travail-rome-main-tree',
  url: 'https://www.data.gouv.fr/api/1/datasets/r/88342be1-06b8-4ab6-8ce9-83e117d21346',
};

const MINIMUM_ENTRIES = 1000;
const MINIMUM_DOMAINS = 100;
const DRY_RUN = process.env.DRY_RUN === '1';

if (!DRY_RUN && getApps().length === 0) {
  initializeApp();
}

const db = DRY_RUN ? null : getFirestore();

function cleanText(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function chooseDelimiter(line) {
  return [';', '\t', ',']
    .map((delimiter) => ({
      delimiter,
      count: line.split(delimiter).length - 1,
    }))
    .sort((a, b) => b.count - a.count)[0]?.delimiter || ';';
}

function parseCsv(text) {
  const input = String(text || '').replace(/^\uFEFF/, '');
  const firstLine = input.split(/\r?\n/).find((line) => line.trim()) || '';
  const delimiter = chooseDelimiter(firstLine);

  const rows = [];
  let row = [];
  let current = '';
  let quoted = false;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    const next = input[index + 1];

    if (char === '"' && quoted && next === '"') {
      current += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      quoted = !quoted;
      continue;
    }

    if (char === delimiter && !quoted) {
      row.push(current);
      current = '';
      continue;
    }

    if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && next === '\n') index += 1;

      row.push(current);
      current = '';

      if (row.some((cell) => cleanText(cell))) {
        rows.push(row);
      }

      row = [];
      continue;
    }

    current += char;
  }

  if (current || row.length > 0) {
    row.push(current);
    rows.push(row);
  }

  if (rows.length < 2) return [];

  const headers = rows[0].map((header, index) => {
    const normalized = cleanText(header)
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');

    return normalized || `col_${index}`;
  });

  return rows.slice(1).map((cells) => {
    const output = {};

    headers.forEach((header, index) => {
      output[header] = cells[index] ?? '';
    });

    return output;
  });
}

function parseBufferPayloads(buffer) {
  const payloads = [];

  const isZip =
    buffer.length >= 4 &&
    buffer[0] === 0x50 &&
    buffer[1] === 0x4b;

  if (isZip) {
    const zip = new AdmZip(buffer);

    for (const entry of zip.getEntries()) {
      if (entry.isDirectory) continue;

      const name = entry.entryName.toLowerCase();
      if (!name.endsWith('.json') && !name.endsWith('.csv') && !name.endsWith('.txt')) {
        continue;
      }

      const text = entry.getData().toString('utf8').replace(/^\uFEFF/, '');
      const trimmed = text.trim();

      if (!trimmed) continue;

      try {
        if (name.endsWith('.json') || trimmed.startsWith('{') || trimmed.startsWith('[')) {
          payloads.push(JSON.parse(text));
        } else {
          payloads.push(parseCsv(text));
        }
      } catch (error) {
        console.warn(`Fichier ignoré dans l'archive: ${entry.entryName}: ${error.message}`);
      }
    }

    return payloads;
  }

  const text = buffer.toString('utf8').replace(/^\uFEFF/, '');
  const trimmed = text.trim();

  if (!trimmed) return [];

  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    return [JSON.parse(text)];
  }

  return [parseCsv(text)];
}

function parseDomainWorkbookRows(buffer) {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheetName = workbook.SheetNames.find((name) =>
    /arbo\s+principale/i.test(String(name || ''))
  );

  if (!sheetName) {
    throw new Error('ROME main tree workbook has no main hierarchy sheet');
  }

  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    raw: false,
    defval: '',
  });

  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error('ROME main tree workbook is empty');
  }

  return {
    sheetName,
    rows,
  };
}

async function fetchSource(source) {
  const response = await fetch(source.url, {
    headers: {
      Accept: '*/*',
      'User-Agent': 'ApprentiFR ROME reference importer',
    },
  });

  if (!response.ok) {
    throw new Error(`${source.name}: HTTP ${response.status}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  const hash = crypto.createHash('sha256').update(buffer).digest('hex');
  const sourceVersion = `sha256:${hash}`;
  const payloads = parseBufferPayloads(buffer);

  const entries = extractRomeReferenceEntries(payloads, {
    source: source.source,
    sourceVersion,
  });

  const validation = validateRomeReference(entries, {
    minimumEntries: MINIMUM_ENTRIES,
  });

  if (!validation.ok) {
    throw new Error(`${source.name}: ${validation.error}`);
  }

  return {
    ...source,
    entries,
    sourceVersion,
    sourceHash: hash,
  };
}

async function fetchDomainSource(occupationResult) {
  const response = await fetch(DOMAIN_SOURCE.url, {
    headers: {
      Accept: '*/*',
      'User-Agent': 'ApprentiFR ROME domain reference importer',
    },
  });

  if (!response.ok) {
    throw new Error(`${DOMAIN_SOURCE.name}: HTTP ${response.status}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  const hash = crypto.createHash('sha256').update(buffer).digest('hex');
  const sourceVersion = `sha256:${hash}`;
  const workbook = parseDomainWorkbookRows(buffer);

  const entries = extractRomeDomainReferenceEntries(
    workbook.rows,
    occupationResult.entries,
    {
      source: DOMAIN_SOURCE.source,
      sourceVersion,
      occupationSourceVersion: occupationResult.sourceVersion,
    }
  );

  const validation = validateRomeDomainReference(
    entries,
    occupationResult.entries,
    {
      minimumDomains: MINIMUM_DOMAINS,
    }
  );

  if (!validation.ok) {
    throw new Error(
      `${DOMAIN_SOURCE.name}: ${validation.error || 'invalid domain reference'}`
    );
  }

  return {
    ...DOMAIN_SOURCE,
    entries,
    validation,
    sheetName: workbook.sheetName,
    sourceVersion,
    sourceHash: hash,
  };
}

async function commitEntryBatches(runId, sourceResult) {
  let batch = db.batch();
  let pending = 0;

  for (const entry of sourceResult.entries) {
    const docId = `${runId}_${entry.romeCode}`;
    const ref = db.collection('occupationReference').doc(docId);

    batch.set(ref, {
      ...entry,
      importRunId: runId,
      sourceUrl: sourceResult.url,
      importedAt: FieldValue.serverTimestamp(),
      schemaVersion: 'occupationReference.v1',
    });

    pending += 1;

    if (pending >= 400) {
      await batch.commit();
      batch = db.batch();
      pending = 0;
    }
  }

  if (pending > 0) {
    await batch.commit();
  }
}

async function commitDomainEntryBatches(domainPublication) {
  let batch = db.batch();
  let pending = 0;

  for (const document of domainPublication.documents) {
    const docId = `${domainPublication.run.runId}_${document.domainCode}`;
    const ref = db.collection('occupationDomainReference').doc(docId);

    batch.set(ref, {
      ...document,
      importedAt: FieldValue.serverTimestamp(),
    });

    pending += 1;

    if (pending >= 400) {
      await batch.commit();
      batch = db.batch();
      pending = 0;
    }
  }

  if (pending > 0) {
    await batch.commit();
  }
}

async function publishReferences(occupationResult, domainResult) {
  const date = new Date().toISOString().slice(0, 10);
  const occupationRunId =
    `rome_${date}_${occupationResult.sourceHash.slice(0, 12)}`;
  const domainRunId =
    `rome_domain_${date}_${domainResult.sourceHash.slice(0, 12)}_${occupationResult.sourceHash.slice(0, 8)}`;

  const domainPublication = buildRomeDomainPublication(
    {
      domainEntries: domainResult.entries,
      occupationEntries: occupationResult.entries,
      runId: domainRunId,
      source: domainResult.source,
      sourceName: domainResult.name,
      sourceUrl: domainResult.url,
      sourceVersion: domainResult.sourceVersion,
      occupationRunId,
      occupationSourceVersion: occupationResult.sourceVersion,
    },
    {
      minimumDomains: MINIMUM_DOMAINS,
    }
  );

  if (DRY_RUN) {
    console.log(JSON.stringify({
      ok: true,
      dryRun: true,
      occupation: {
        runId: occupationRunId,
        source: occupationResult.source,
        sourceVersion: occupationResult.sourceVersion,
        count: occupationResult.entries.length,
        sample: occupationResult.entries.slice(0, 5),
      },
      domains: {
        runId: domainRunId,
        source: domainResult.source,
        sourceVersion: domainResult.sourceVersion,
        occupationSourceVersion: occupationResult.sourceVersion,
        sheetName: domainResult.sheetName,
        count: domainPublication.documents.length,
        validation: domainPublication.validation,
        sample: domainPublication.documents.slice(0, 5),
      },
    }, null, 2));
    return;
  }

  const occupationRunRef = db
    .collection('occupationReferenceRuns')
    .doc(occupationRunId);
  const domainRunRef = db
    .collection('occupationDomainReferenceRuns')
    .doc(domainRunId);

  await Promise.all([
    occupationRunRef.set({
      runId: occupationRunId,
      status: 'building',
      source: occupationResult.source,
      sourceName: occupationResult.name,
      sourceUrl: occupationResult.url,
      sourceVersion: occupationResult.sourceVersion,
      expectedEntries: occupationResult.entries.length,
      startedAt: FieldValue.serverTimestamp(),
      schemaVersion: 'occupationReferenceRun.v1',
    }, { merge: true }),
    domainRunRef.set({
      ...domainPublication.run,
      sheetName: domainResult.sheetName,
      startedAt: FieldValue.serverTimestamp(),
    }, { merge: true }),
  ]);

  try {
    await commitEntryBatches(occupationRunId, occupationResult);
    await commitDomainEntryBatches(domainPublication);

    await Promise.all([
      occupationRunRef.set({
        status: 'ready',
        writtenEntries: occupationResult.entries.length,
        completedAt: FieldValue.serverTimestamp(),
      }, { merge: true }),
      domainRunRef.set({
        status: 'ready',
        writtenEntries: domainPublication.documents.length,
        completedAt: FieldValue.serverTimestamp(),
      }, { merge: true }),
    ]);

    const pointerBatch = db.batch();

    pointerBatch.set(
      db.collection('occupationReferenceMeta').doc('current'),
      {
        runId: occupationRunId,
        source: occupationResult.source,
        sourceName: occupationResult.name,
        sourceUrl: occupationResult.url,
        sourceVersion: occupationResult.sourceVersion,
        entriesCount: occupationResult.entries.length,
        importedAt: FieldValue.serverTimestamp(),
        schemaVersion: 'occupationReferenceMeta.v1',
      }
    );

    pointerBatch.set(
      db.collection('occupationDomainReferenceMeta').doc('current'),
      {
        ...domainPublication.meta,
        sheetName: domainResult.sheetName,
        importedAt: FieldValue.serverTimestamp(),
      }
    );

    await pointerBatch.commit();

    console.log(JSON.stringify({
      ok: true,
      dryRun: false,
      occupation: {
        runId: occupationRunId,
        source: occupationResult.source,
        sourceVersion: occupationResult.sourceVersion,
        count: occupationResult.entries.length,
      },
      domains: {
        runId: domainRunId,
        source: domainResult.source,
        sourceVersion: domainResult.sourceVersion,
        occupationSourceVersion: occupationResult.sourceVersion,
        count: domainPublication.documents.length,
        validation: domainPublication.validation,
      },
    }, null, 2));
  } catch (error) {
    const failure = {
      status: 'failed',
      error: String(error?.message || error).slice(0, 1000),
      failedAt: FieldValue.serverTimestamp(),
    };

    await Promise.allSettled([
      occupationRunRef.set(failure, { merge: true }),
      domainRunRef.set(failure, { merge: true }),
    ]);

    throw error;
  }
}

async function main() {
  const failures = [];
  let occupationResult = null;

  for (const source of SOURCES) {
    try {
      console.log(`Lecture ROME: ${source.name}`);
      occupationResult = await fetchSource(source);
      console.log(
        `${source.name}: ${occupationResult.entries.length} codes ROME valides`
      );
      break;
    } catch (error) {
      failures.push(`${source.name}: ${error.message}`);
      console.warn(failures[failures.length - 1]);
    }
  }

  if (!occupationResult) {
    throw new Error(
      `Aucune source ROME exploitable. ${failures.join(' | ')}`
    );
  }

  console.log(`Lecture domaines ROME: ${DOMAIN_SOURCE.name}`);
  const domainResult = await fetchDomainSource(occupationResult);
  console.log(
    `${DOMAIN_SOURCE.name}: ${domainResult.entries.length} domaines professionnels valides`
  );

  await publishReferences(occupationResult, domainResult);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
