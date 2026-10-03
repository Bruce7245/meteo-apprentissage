function getOfferBackfillWindow(departments, currentIndex, batchSize = 10) {
  const list = Array.isArray(departments) ? departments : [];
  const size = Math.max(1, Number.parseInt(String(batchSize || 10), 10) || 10);
  const index = Math.max(0, Number.parseInt(String(currentIndex || 0), 10) || 0);
  const totalDepartments = list.length;
  const totalBatches = Math.max(1, Math.ceil(totalDepartments / size));

  if (index >= totalDepartments) {
    return {
      done: true,
      batchNumber: totalBatches,
      batchSize: size,
      totalDepartments,
      totalBatches,
      startIndex: totalDepartments,
      endIndexExclusive: totalDepartments,
      items: [],
    };
  }

  const batchNumber = Math.floor(index / size) + 1;
  const batchStart = (batchNumber - 1) * size;
  const batchEnd = Math.min(batchStart + size, totalDepartments);

  return {
    done: false,
    batchNumber,
    batchSize: size,
    totalDepartments,
    totalBatches,
    startIndex: index,
    endIndexExclusive: batchEnd,
    items: list.slice(index, batchEnd),
  };
}

function registerOfferBackfillFailure(currentFailures, maxFailures = 3) {
  const current = Math.max(0, Number.parseInt(String(currentFailures || 0), 10) || 0);
  const max = Math.max(1, Number.parseInt(String(maxFailures || 3), 10) || 3);
  const consecutiveFailures = current + 1;

  return {
    consecutiveFailures,
    shouldPause: consecutiveFailures >= max,
  };
}

module.exports = {
  getOfferBackfillWindow,
  registerOfferBackfillFailure,
};
