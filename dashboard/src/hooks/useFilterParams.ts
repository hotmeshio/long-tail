import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';

interface PaginationState {
  page: number;
  pageSize: number;
  offset: number;
  setPage: (page: number) => void;
  setPageSize: (size: number) => void;
  totalPages: (total: number) => number;
}

export interface SortState {
  sort_by: string;
  order: 'asc' | 'desc';
}

interface UseFilterParamsResult<F extends Record<string, string>> {
  /** Current filter values, read from URL search params. */
  filters: F;
  /** Set a single filter. Resets page to 1. */
  setFilter: (key: keyof F, value: string) => void;
  /** Set multiple filters at once. Resets page to 1. */
  setFilters: (updates: Partial<F>) => void;
  /** Pagination state — same interface as usePagination. */
  pagination: PaginationState;
  /** Current sort state (from URL params). */
  sort: SortState;
  /** Toggle sort: if same column, flip direction; if different, default DESC. */
  setSort: (column: string) => void;
}

/**
 * Unified hook that syncs filter values and pagination with URL search params.
 *
 * - Deep-linking: landing on `?role=reviewer&page=3` pre-fills filters and pagination
 * - Clean URLs: default values (page 1, pageSize 25, empty strings) are omitted
 * - Replace mode: filter changes don't pollute browser history
 * - Auto-reset: changing any filter resets page to 1
 */
export function useFilterParams<F extends Record<string, string> = Record<string, string>>(
  options?: { filters?: F; pageSize?: number },
): UseFilterParamsResult<F> {
  // Freeze config on first render to prevent re-render loops from inline objects
  const configRef = useRef(options);
  const filterDefaults = (configRef.current?.filters ?? {}) as F;
  const filterKeys = useMemo(() => Object.keys(filterDefaults), []);
  const defaultPageSize = configRef.current?.pageSize ?? 25;

  const [searchParams, setSearchParams] = useSearchParams();

  // Keep a stable ref to setSearchParams so downstream callbacks never change identity
  const setSearchParamsRef = useRef(setSearchParams);
  useEffect(() => { setSearchParamsRef.current = setSearchParams; });

  // ── Read current values from URL ──────────────────────────────────────────

  const filters = useMemo(() => {
    const result = {} as Record<string, string>;
    for (const key of filterKeys) {
      result[key] = searchParams.get(key) ?? filterDefaults[key];
    }
    return result as F;
  }, [searchParams, filterKeys, filterDefaults]);

  const page = Number(searchParams.get('page')) || 1;
  const pageSize = Number(searchParams.get('pageSize')) || defaultPageSize;
  const offset = useMemo(() => (page - 1) * pageSize, [page, pageSize]);

  // ── Batch-update helper ───────────────────────────────────────────────────

  const updateParams = useCallback(
    (updates: Record<string, string | null>) => {
      setSearchParamsRef.current(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [k, v] of Object.entries(updates)) {
            if (v === null || v === '' || v === undefined) {
              next.delete(k);
            } else {
              next.set(k, v);
            }
          }
          return next;
        },
        { replace: true },
      );
    },
    [],
  );

  // ── Filter setters (auto-reset page) ──────────────────────────────────────

  const setFilter = useCallback(
    (key: keyof F, value: string) => {
      updateParams({ [key as string]: value || null, page: null });
    },
    [updateParams],
  );

  const setFilters = useCallback(
    (updates: Partial<F>) => {
      const mapped: Record<string, string | null> = { page: null };
      for (const [k, v] of Object.entries(updates)) {
        mapped[k] = (v as string) || null;
      }
      updateParams(mapped);
    },
    [updateParams],
  );

  // ── Pagination ────────────────────────────────────────────────────────────

  const setPage = useCallback(
    (p: number) => {
      updateParams({ page: p <= 1 ? null : String(p) });
    },
    [updateParams],
  );

  const setPageSize = useCallback(
    (size: number) => {
      updateParams({
        pageSize: size === defaultPageSize ? null : String(size),
        page: null,
      });
    },
    [updateParams, defaultPageSize],
  );

  const totalPages = useCallback(
    (total: number) => Math.max(1, Math.ceil(total / pageSize)),
    [pageSize],
  );

  const pagination: PaginationState = useMemo(
    () => ({ page, pageSize, offset, setPage, setPageSize, totalPages }),
    [page, pageSize, offset, setPage, setPageSize, totalPages],
  );

  // ── Sort ─────────────────────────────────────────────────────────────────

  const sort: SortState = useMemo(
    () => ({
      sort_by: searchParams.get('sort_by') ?? '',
      order: (searchParams.get('order') as 'asc' | 'desc') || 'desc',
    }),
    [searchParams],
  );

  const setSort = useCallback(
    (column: string) => {
      const isSame = sort.sort_by === column;
      updateParams({
        sort_by: column || null,
        order: isSame ? (sort.order === 'desc' ? 'asc' : 'desc') : 'desc',
        page: null,
      });
    },
    [sort.sort_by, sort.order, updateParams],
  );

  return { filters, setFilter, setFilters, pagination, sort, setSort };
}
