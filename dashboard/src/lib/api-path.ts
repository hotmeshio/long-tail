/**
 * Build an API path with a query string from a params object.
 *
 * Used by list pages so the "copy URL / copy curl" affordance (ListToolbar)
 * ALWAYS reflects the exact request the list is making — pass the same params
 * object the data hook receives, and the generated command can never drift from
 * the active filters/search/sort/pagination.
 *
 * Skips `undefined` / `null` / `''` so absent filters don't appear in the URL.
 * Values are URL-encoded.
 */
export type ApiParamValue = string | number | boolean | undefined | null;

export function buildApiPath(base: string, params: Record<string, ApiParamValue>): string {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    qs.set(key, String(value));
  }
  const query = qs.toString();
  return query ? `${base}?${query}` : base;
}
