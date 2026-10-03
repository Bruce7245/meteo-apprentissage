const DEFAULT_FORMATION_CAPACITY = 8;
const FORMATION_NEED_METHOD_VERSION = "formationNeed.v2";

function getFormationNeedTimeCoefficient(daysBeforeStart) {
  if (daysBeforeStart === null || daysBeforeStart === undefined) return 0;

  const days = Number(daysBeforeStart);

  if (!Number.isFinite(days)) return 0;

  if (days > 180) return 0.10;
  if (days > 120) return 0.20;
  if (days > 90) return 0.35;
  if (days > 60) return 0.50;
  if (days > 30) return 0.70;
  if (days > 15) return 0.85;
  if (days >= 0) return 1.00;
  if (days >= -30) return 0.60;
  if (days >= -90) return 0.25;

  return 0;
}

function computeFormationNeed({
  capacity,
  daysBeforeStart,
  defaultCapacity = DEFAULT_FORMATION_CAPACITY,
}) {
  const parsedCapacity = Number(capacity);
  const parsedDefault = Number(defaultCapacity);

  const safeDefaultCapacity =
    Number.isFinite(parsedDefault) && parsedDefault > 0
      ? parsedDefault
      : DEFAULT_FORMATION_CAPACITY;

  const hasKnownCapacity =
    Number.isFinite(parsedCapacity) && parsedCapacity > 0;

  const retainedCapacity = hasKnownCapacity
    ? parsedCapacity
    : safeDefaultCapacity;

  const coefficient = getFormationNeedTimeCoefficient(daysBeforeStart);

  return {
    hasKnownCapacity,
    retainedCapacity,
    coefficient,
    estimatedNeed: retainedCapacity * coefficient,
  };
}

module.exports = {
  DEFAULT_FORMATION_CAPACITY,
  FORMATION_NEED_METHOD_VERSION,
  getFormationNeedTimeCoefficient,
  computeFormationNeed,
};
