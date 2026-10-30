import type { BaseQueryApi, BaseQueryFn, FetchArgs, FetchBaseQueryError } from '@reduxjs/toolkit/query';

type Page<T> = { results?: T[]; next?: string | null } | T[];

/** Bounded compatibility adapter for existing screens that need a complete filtered result set. */
export async function fetchAllPages<T>(
  url: string,
  baseQuery: (arg: string | FetchArgs, api: BaseQueryApi, extraOptions: unknown) => Promise<{ data?: unknown; error?: FetchBaseQueryError }>,
  api: BaseQueryApi,
  extraOptions: unknown,
  pageSize = 200,
  maxPages: number | null = 100,
): Promise<{ data: T[] } | { error: FetchBaseQueryError }> {
  const rows: T[] = [];
  for (let page = 1; maxPages === null || page <= maxPages; page += 1) {
    const separator = url.includes('?') ? '&' : '?';
    const result = await baseQuery(`${url}${separator}page=${page}&page_size=${pageSize}`, api, extraOptions);
    if (result.error) return { error: result.error };
    const payload = result.data as Page<T>;
    if (Array.isArray(payload)) return { data: payload };
    rows.push(...(payload.results || []));
    if (!payload.next) return { data: rows };
  }
  return {
    error: {
      status: 'CUSTOM_ERROR',
      error: `The result exceeds the ${pageSize * (maxPages || 0)} row safety limit. Add a filter and try again.`,
    },
  };
}
