const LEVEL_META = {
  green: {
    key: 'green',
    label: 'Vert',
    css: 'vert',
    order: 0,
  },
  vert: {
    key: 'green',
    label: 'Vert',
    css: 'vert',
    order: 0,
  },
  yellow: {
    key: 'yellow',
    label: 'Jaune',
    css: 'jaune',
    order: 1,
  },
  jaune: {
    key: 'yellow',
    label: 'Jaune',
    css: 'jaune',
    order: 1,
  },
  orange: {
    key: 'orange',
    label: 'Orange',
    css: 'orange',
    order: 2,
  },
  red: {
    key: 'red',
    label: 'Rouge',
    css: 'rouge',
    order: 3,
  },
  rouge: {
    key: 'red',
    label: 'Rouge',
    css: 'rouge',
    order: 3,
  },
};

export function normalizeLevelKey(level) {
  return String(level || 'green')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '');
}

export function getLevelMeta(level) {
  return LEVEL_META[normalizeLevelKey(level)] || LEVEL_META.green;
}

export function getLevelLabel(level) {
  return getLevelMeta(level).label;
}

export function getLevelCss(level) {
  return getLevelMeta(level).css;
}

export function getLevelOrder(level) {
  return getLevelMeta(level).order;
}

export function sortByVigilanceThenCode(items) {
  return [...items].sort((a, b) => {
    const levelDiff = getLevelOrder(b.level || b.publishedLevel) - getLevelOrder(a.level || a.publishedLevel);
    if (levelDiff !== 0) return levelDiff;

    return String(a.code || a.departmentCode || '').localeCompare(
      String(b.code || b.departmentCode || ''),
      'fr',
      { numeric: true }
    );
  });
}
