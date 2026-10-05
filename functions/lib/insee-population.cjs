function cleanText(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/\s+/g, ' ').trim();
}

function normalizeKey(value) {
  return cleanText(value)
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeDepartmentCode(value) {
  const text = cleanText(value).toUpperCase();

  if (text === '2A' || text === '2B') return text;

  if (/^\d+$/.test(text)) {
    const number = Number(text);

    if (number >= 1 && number <= 19) return String(number).padStart(2, '0');
    if (number >= 21 && number <= 95) return String(number).padStart(2, '0');
    if ([971, 972, 973, 974, 976].includes(number)) return String(number);
  }

  return null;
}

function normalizeGeoObject(value) {
  const key = normalizeKey(value).replace(/ /g, '');

  if (['dep', 'departement', 'department'].includes(key)) {
    return 'DEP';
  }

  return null;
}

function normalizeSex(value) {
  const text = cleanText(value).toUpperCase();
  const key = normalizeKey(value);

  if (['_T', 'T', 'TOTAL'].includes(text) || key === 'ensemble') {
    return '_T';
  }

  return text;
}

function normalizeAge(value) {
  const text = cleanText(value).toUpperCase().replace(/\s+/g, '');
  const key = normalizeKey(value);

  if (['_T', 'T', 'TOTAL'].includes(text) || key === 'ensemble') {
    return '_T';
  }

  const compact = key.replace(/ /g, '');

  if (
    text === 'Y15T19' ||
    /^(?:15)(?:a|to|-)?19(?:ans)?$/.test(compact)
  ) {
    return 'Y15T19';
  }

  if (
    text === 'Y20T24' ||
    /^(?:20)(?:a|to|-)?24(?:ans)?$/.test(compact)
  ) {
    return 'Y20T24';
  }

  if (
    text === 'Y25T29' ||
    /^(?:25)(?:a|to|-)?29(?:ans)?$/.test(compact)
  ) {
    return 'Y25T29';
  }

  return text || null;
}

function parsePopulationNumber(value, context = '') {
  if (value === null || value === undefined || value === '') {
    throw new Error(`Invalid population value${context ? ` for ${context}` : ''}`);
  }

  const normalized = typeof value === 'string'
    ? value.replace(/[\s\u00a0\u202f]/g, '').replace(',', '.')
    : value;

  const number = Number(normalized);

  if (!Number.isFinite(number) || number < 0) {
    throw new Error(`Invalid population value${context ? ` for ${context}` : ''}: ${value}`);
  }

  return Math.round(number);
}

function buildDepartmentPopulation(rows, referenceYear) {
  const year = Number(referenceYear);

  if (!Number.isInteger(year) || year < 1900 || year > 2200) {
    throw new Error(`Invalid population reference year: ${referenceYear}`);
  }

  const byDepartment = new Map();

  for (const row of Array.isArray(rows) ? rows : []) {
    if (normalizeGeoObject(row?.GEO_OBJECT) !== 'DEP') continue;
    if (normalizeSex(row?.SEX) !== '_T') continue;

    const rowYear = Number(row?.TIME_PERIOD);
    if (rowYear !== year) continue;

    const departmentCode = normalizeDepartmentCode(row?.GEO);
    if (!departmentCode) continue;

    const age = normalizeAge(row?.AGE);
    if (!['_T', 'Y15T19', 'Y20T24', 'Y25T29'].includes(age)) continue;

    const value = parsePopulationNumber(
      row?.OBS_VALUE_NIVEAU ?? row?.OBS_VALUE,
      `${departmentCode}/${age}`
    );

    if (!byDepartment.has(departmentCode)) {
      byDepartment.set(departmentCode, {
        departmentCode,
        values: new Map(),
      });
    }

    const group = byDepartment.get(departmentCode);
    const previous = group.values.get(age);

    if (previous !== undefined && previous !== value) {
      throw new Error(
        `Conflicting population values for department ${departmentCode} / ${age}`
      );
    }

    group.values.set(age, value);
  }

  const result = new Map();

  for (const departmentCode of Array.from(byDepartment.keys())
    .sort((a, b) => a.localeCompare(b, 'fr', { numeric: true }))) {
    const values = byDepartment.get(departmentCode).values;
    const required = ['_T', 'Y15T19', 'Y20T24', 'Y25T29'];
    const missing = required.filter((key) => !values.has(key));

    if (missing.length > 0) {
      throw new Error(
        `Incomplete population age data for department ${departmentCode}: missing ${missing.join(', ')}`
      );
    }

    result.set(departmentCode, {
      departmentCode,
      populationTotal: values.get('_T'),
      population15To29:
        values.get('Y15T19') +
        values.get('Y20T24') +
        values.get('Y25T29'),
      referenceYear: year,
    });
  }

  return result;
}

function headerAgeKind(value) {
  const age = normalizeAge(value);
  return ['Y15T19', 'Y20T24', 'Y25T29'].includes(age) ? age : null;
}

function findWorksheetHeader(row) {
  if (!Array.isArray(row)) return null;

  let codeIndex = -1;
  let totalIndex = -1;
  const ageIndexes = {};

  row.forEach((cell, index) => {
    const key = normalizeKey(cell);
    const compact = key.replace(/ /g, '');

    if (
      codeIndex < 0 &&
      (
        key === 'code' ||
        key === 'code departement' ||
        key === 'code du departement' ||
        compact === 'codedepartement'
      )
    ) {
      codeIndex = index;
    }

    if (
      totalIndex < 0 &&
      (
        key === 'total' ||
        key === 'ensemble' ||
        key === 'population totale'
      )
    ) {
      totalIndex = index;
    }

    const age = headerAgeKind(cell);
    if (age && ageIndexes[age] === undefined) {
      ageIndexes[age] = index;
    }
  });

  if (
    codeIndex < 0 ||
    totalIndex < 0 ||
    ageIndexes.Y15T19 === undefined ||
    ageIndexes.Y20T24 === undefined ||
    ageIndexes.Y25T29 === undefined
  ) {
    return null;
  }

  return {
    codeIndex,
    totalIndex,
    ageIndexes,
  };
}

function findWorksheetTwoRowHeader(groupRow, ageRow) {
  if (!Array.isArray(groupRow) || !Array.isArray(ageRow)) return null;

  const codeIndex = groupRow.findIndex((cell) => {
    const key = normalizeKey(cell);
    return key === 'departement' || key === 'departements';
  });
  const ensembleIndex = groupRow.findIndex(
    (cell) => normalizeKey(cell) === 'ensemble'
  );

  if (codeIndex < 0 || ensembleIndex < 0) return null;

  let groupEnd = groupRow.length;
  for (let index = ensembleIndex + 1; index < groupRow.length; index += 1) {
    if (cleanText(groupRow[index])) {
      groupEnd = index;
      break;
    }
  }

  let totalIndex = -1;
  const ageIndexes = {};

  for (let index = ensembleIndex; index < groupEnd; index += 1) {
    const key = normalizeKey(ageRow[index]);

    if (
      totalIndex < 0 &&
      (
        key === 'total' ||
        key === 'ensemble' ||
        key === 'population totale'
      )
    ) {
      totalIndex = index;
    }

    const age = headerAgeKind(ageRow[index]);
    if (age && ageIndexes[age] === undefined) {
      ageIndexes[age] = index;
    }
  }

  if (
    totalIndex < 0 ||
    ageIndexes.Y15T19 === undefined ||
    ageIndexes.Y20T24 === undefined ||
    ageIndexes.Y25T29 === undefined
  ) {
    return null;
  }

  return {
    codeIndex,
    totalIndex,
    ageIndexes,
  };
}

function isBlankRow(row) {
  return !Array.isArray(row) || row.every((cell) => cleanText(cell) === '');
}

function buildDepartmentPopulationFromWorksheetRows(worksheetRows, referenceYear) {
  const year = Number(referenceYear);
  const candidates = new Map();
  const rows = Array.isArray(worksheetRows) ? worksheetRows : [];

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const twoRowHeader = findWorksheetTwoRowHeader(
      rows[rowIndex],
      rows[rowIndex + 1]
    );
    const header = twoRowHeader || findWorksheetHeader(rows[rowIndex]);
    if (!header) continue;

    const dataStartIndex = rowIndex + (twoRowHeader ? 2 : 1);

    for (let dataIndex = dataStartIndex; dataIndex < rows.length; dataIndex += 1) {
      const row = rows[dataIndex];

      if (isBlankRow(row)) break;
      if (findWorksheetHeader(row)) break;

      const departmentCode = normalizeDepartmentCode(row?.[header.codeIndex]);
      if (!departmentCode) {
        if (cleanText(row?.[header.codeIndex])) break;
        continue;
      }

      const populationTotal = parsePopulationNumber(
        row[header.totalIndex],
        `${departmentCode}/total`
      );
      const y15 = parsePopulationNumber(
        row[header.ageIndexes.Y15T19],
        `${departmentCode}/15-19`
      );
      const y20 = parsePopulationNumber(
        row[header.ageIndexes.Y20T24],
        `${departmentCode}/20-24`
      );
      const y25 = parsePopulationNumber(
        row[header.ageIndexes.Y25T29],
        `${departmentCode}/25-29`
      );

      const candidate = {
        departmentCode,
        populationTotal,
        population15To29: y15 + y20 + y25,
        referenceYear: year,
      };

      const previous = candidates.get(departmentCode);

      // The workbook can contain Ensemble/Hommes/Femmes blocks.
      // Retain the largest total, which is the Ensemble population.
      if (!previous || candidate.populationTotal > previous.populationTotal) {
        candidates.set(departmentCode, candidate);
      }
    }
  }

  return new Map(
    Array.from(candidates.entries())
      .sort(([a], [b]) => a.localeCompare(b, 'fr', { numeric: true }))
  );
}

module.exports = {
  normalizeDepartmentCode,
  buildDepartmentPopulation,
  buildDepartmentPopulationFromWorksheetRows,
};
