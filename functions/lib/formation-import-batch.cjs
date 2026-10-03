function getDepartmentBatch(departments, batchNumber, batchSize = 10) {
  const safeDepartments = Array.isArray(departments) ? departments : [];
  const size = Number.parseInt(String(batchSize), 10);
  const batch = Number.parseInt(String(batchNumber), 10);

  if (!Number.isInteger(size) || size < 1) {
    throw new Error("batchSize must be a positive integer");
  }

  const totalDepartments = safeDepartments.length;
  const totalBatches = Math.max(1, Math.ceil(totalDepartments / size));

  if (!Number.isInteger(batch) || batch < 1 || batch > totalBatches) {
    throw new Error(`batch must be between 1 and ${totalBatches}`);
  }

  const startIndex = (batch - 1) * size;
  const endIndexExclusive = Math.min(startIndex + size, totalDepartments);
  const items = safeDepartments.slice(startIndex, endIndexExclusive);

  return {
    batchNumber: batch,
    batchSize: size,
    totalDepartments,
    totalBatches,
    startIndex,
    endIndexExclusive,
    items,
  };
}

function getNextPageIndex({ pagination, pageIndex, pageSize, receivedCount }) {
  const currentPageIndex = Number(pageIndex || 0);
  const size = Number(pageSize || 0);
  const received = Number(receivedCount || 0);
  const meta = pagination && typeof pagination === "object" ? pagination : {};

  if (meta.has_next === false || meta.hasNext === false) {
    return null;
  }

  const nextPageKeys = [
    "next_page_index",
    "nextPageIndex",
    "next_page",
    "nextPage",
    "page_suivante",
  ];

  for (const key of nextPageKeys) {
    if (!Object.prototype.hasOwnProperty.call(meta, key)) continue;

    const explicitNext = meta[key];

    if (explicitNext === null || explicitNext === false || explicitNext === "") {
      return null;
    }

    const parsed = Number(explicitNext);
    if (Number.isFinite(parsed) && parsed > currentPageIndex) {
      return parsed;
    }
  }

  const totalPages = Number(
    meta.total_pages ??
    meta.totalPages ??
    meta.page_count ??
    meta.pageCount
  );

  if (Number.isFinite(totalPages) && totalPages >= 0) {
    return currentPageIndex + 1 < totalPages
      ? currentPageIndex + 1
      : null;
  }

  const totalCount = Number(
    meta.total ??
    meta.total_count ??
    meta.totalCount ??
    meta.count
  );

  if (Number.isFinite(totalCount) && size > 0) {
    return (currentPageIndex + 1) * size < totalCount
      ? currentPageIndex + 1
      : null;
  }

  if (size > 0 && received < size) {
    return null;
  }

  if (received === 0) {
    return null;
  }

  return currentPageIndex + 1;
}

module.exports = {
  getDepartmentBatch,
  getNextPageIndex,
};
