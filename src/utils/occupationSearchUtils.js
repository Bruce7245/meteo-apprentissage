import { normalizeRomeCode } from './occupationUtils.js';

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

export function resolveOccupationSearchResult(result = {}) {
  if (result.type === 'occupation') {
    const romeCode = normalizeRomeCode(result.romeCode);
    const label = cleanText(result.label);

    if (!romeCode || !label) {
      return {
        status: 'unavailable',
        message: 'Ce métier ne possède pas de code ROME exploitable.',
      };
    }

    return {
      status: 'selected',
      selection: {
        type: 'occupation',
        romeCode,
        label,
      },
    };
  }

  if (result.type === 'training') {
    const choices = Array.from(
      new Set(
        (Array.isArray(result.romeCodes) ? result.romeCodes : [])
          .map(normalizeRomeCode)
          .filter(Boolean)
      )
    ).sort((a, b) => a.localeCompare(b, 'fr'));

    if (choices.length === 0) {
      return {
        status: 'unavailable',
        message: 'Aucun métier ROME exploitable pour cette formation.',
      };
    }

    const trainingId = cleanText(result.publicId);
    const trainingLabel = cleanText(result.label) || 'Formation';

    if (choices.length === 1) {
      return {
        status: 'selected',
        selection: {
          type: 'training',
          trainingId,
          trainingLabel,
          romeCode: choices[0],
          label: choices[0],
        },
      };
    }

    return {
      status: 'requires_rome_choice',
      training: {
        trainingId,
        trainingLabel,
      },
      choices,
    };
  }

  return {
    status: 'unavailable',
    message: 'Résultat de recherche non exploitable.',
  };
}
