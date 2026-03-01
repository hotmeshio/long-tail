import { useState, useCallback, useMemo } from 'react';

interface PaginationState {
  page: number;
  pageSize: number;
  offset: number;
  setPage: (page: number) => void;
  setPageSize: (size: number) => void;
  totalPages: (total: number) => number;
}

export function usePagination(initialPageSize = 25): PaginationState {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSizeState] = useState(initialPageSize);

  const offset = useMemo(() => (page - 1) * pageSize, [page, pageSize]);

  const setPageSize = useCallback((size: number) => {
    setPageSizeState(size);
    setPage(1);
  }, []);

  const totalPages = useCallback(
    (total: number) => Math.max(1, Math.ceil(total / pageSize)),
    [pageSize],
  );

  return { page, pageSize, offset, setPage, setPageSize, totalPages };
}
