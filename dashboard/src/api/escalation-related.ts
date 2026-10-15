import { useQuery } from '@tanstack/react-query';
import { apiFetch } from './client';
import type { RelatedAggregatesResponse, RelatedRowsResponse } from '../lib/list-schema';

/**
 * Every related set a role's list schema declares, aggregated for one page
 * of host rows. Keyed under `escalations`, so the list's live invalidation
 * refreshes it with the rows.
 */
export function useRelatedAggregates(role: string, ids: string[], version: number | null | undefined, enabled = true) {
  const sorted = [...ids].sort();
  return useQuery<RelatedAggregatesResponse>({
    queryKey: ['escalations', 'related', role, version ?? 'latest', sorted],
    queryFn: () =>
      apiFetch('/escalations/related', {
        method: 'POST',
        body: JSON.stringify({ role, ids: sorted, ...(version != null ? { version } : {}) }),
      }),
    enabled: enabled && !!role && sorted.length > 0,
    placeholderData: (prev) => prev,
  });
}

/** One host row's rows in one related set, loaded when its detail opens. */
export function useRelatedRows(
  role: string,
  id: string,
  set: string,
  version: number | null | undefined,
  limit?: number,
  enabled = true,
) {
  return useQuery<RelatedRowsResponse>({
    queryKey: ['escalations', 'related-rows', role, version ?? 'latest', id, set, limit ?? null],
    queryFn: () =>
      apiFetch('/escalations/related/rows', {
        method: 'POST',
        body: JSON.stringify({ role, id, set, ...(version != null ? { version } : {}), ...(limit ? { limit } : {}) }),
      }),
    enabled: enabled && !!role && !!id && !!set,
  });
}
