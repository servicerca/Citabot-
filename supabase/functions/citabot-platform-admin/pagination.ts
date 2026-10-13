export type PageResult<T> = {
  data: T[] | null;
  error: unknown | null;
};

/**
 * Reads every page of a PostgREST query without silently accepting the API
 * row cap as the complete result. Each callback must create a fresh query
 * with a stable ordering before applying the inclusive range.
 */
export async function fetchAllPages<T>(
  fetchPage: (from: number, to: number) => PromiseLike<PageResult<T>>,
  options: { pageSize?: number; maxPages?: number } = {},
): Promise<T[]> {
  const pageSize = options.pageSize ?? 200;
  const maxPages = options.maxPages ?? 1000;

  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 1000) {
    throw new Error("invalid_page_size");
  }
  if (!Number.isInteger(maxPages) || maxPages < 1) {
    throw new Error("invalid_max_pages");
  }

  const rows: T[] = [];
  for (let page = 0; page < maxPages; page++) {
    const from = page * pageSize;
    const to = from + pageSize - 1;
    const result = await fetchPage(from, to);

    if (result.error !== null && result.error !== undefined) {
      throw result.error;
    }

    const pageRows = result.data ?? [];
    if (!Array.isArray(pageRows)) {
      throw new Error("invalid_page_response");
    }
    rows.push(...pageRows);
    if (pageRows.length < pageSize) return rows;
  }

  // Never return a silently truncated aggregate. The caller should surface
  // the failure and the operator can investigate unusually large datasets.
  throw new Error("pagination_safety_limit_exceeded");
}
