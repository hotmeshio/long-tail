import { renderHook, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useFilterParams } from '../useFilterParams';

function wrapper(initialEntry = '/') {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <MemoryRouter initialEntries={[initialEntry]}>
        {children}
      </MemoryRouter>
    );
  };
}

describe('useFilterParams', () => {
  // ── Pagination defaults ───────────────────────────────────────────────────

  it('initializes with default pagination', () => {
    const { result } = renderHook(() => useFilterParams(), {
      wrapper: wrapper(),
    });
    expect(result.current.pagination.page).toBe(1);
    expect(result.current.pagination.pageSize).toBe(25);
    expect(result.current.pagination.offset).toBe(0);
  });

  it('accepts a custom initial page size', () => {
    const { result } = renderHook(
      () => useFilterParams({ pageSize: 50 }),
      { wrapper: wrapper() },
    );
    expect(result.current.pagination.pageSize).toBe(50);
  });

  // ── Deep-linking (reading from URL) ───────────────────────────────────────

  it('reads filter values from URL on mount', () => {
    const { result } = renderHook(
      () => useFilterParams({ filters: { role: '', priority: '' } }),
      { wrapper: wrapper('/test?role=reviewer&priority=2') },
    );
    expect(result.current.filters.role).toBe('reviewer');
    expect(result.current.filters.priority).toBe('2');
  });

  it('reads page and pageSize from URL', () => {
    const { result } = renderHook(
      () => useFilterParams(),
      { wrapper: wrapper('/test?page=3&pageSize=50') },
    );
    expect(result.current.pagination.page).toBe(3);
    expect(result.current.pagination.pageSize).toBe(50);
    expect(result.current.pagination.offset).toBe(100);
  });

  it('defaults missing filter values to empty string', () => {
    const { result } = renderHook(
      () => useFilterParams({ filters: { role: '', type: '' } }),
      { wrapper: wrapper('/test?role=admin') },
    );
    expect(result.current.filters.role).toBe('admin');
    expect(result.current.filters.type).toBe('');
  });

  // ── setFilter ─────────────────────────────────────────────────────────────

  it('updates filter value and resets page to 1', () => {
    const { result } = renderHook(
      () => useFilterParams({ filters: { status: '' } }),
      { wrapper: wrapper('/test?page=3&status=active') },
    );
    expect(result.current.pagination.page).toBe(3);

    act(() => result.current.setFilter('status', 'inactive'));

    expect(result.current.filters.status).toBe('inactive');
    expect(result.current.pagination.page).toBe(1);
  });

  it('removes param when set to empty string', () => {
    const { result } = renderHook(
      () => useFilterParams({ filters: { status: '' } }),
      { wrapper: wrapper('/test?status=active') },
    );

    act(() => result.current.setFilter('status', ''));

    expect(result.current.filters.status).toBe('');
  });

  // ── setFilters (batch) ────────────────────────────────────────────────────

  it('updates multiple filters at once and resets page', () => {
    const { result } = renderHook(
      () => useFilterParams({ filters: { role: '', type: '' } }),
      { wrapper: wrapper('/test?page=5') },
    );

    act(() => result.current.setFilters({ role: 'admin', type: 'review' }));

    expect(result.current.filters.role).toBe('admin');
    expect(result.current.filters.type).toBe('review');
    expect(result.current.pagination.page).toBe(1);
  });

  // ── Pagination ────────────────────────────────────────────────────────────

  it('setPage updates the page and offset', () => {
    const { result } = renderHook(
      () => useFilterParams(),
      { wrapper: wrapper() },
    );

    act(() => result.current.pagination.setPage(3));

    expect(result.current.pagination.page).toBe(3);
    expect(result.current.pagination.offset).toBe(50);
  });

  it('setPageSize resets page to 1', () => {
    const { result } = renderHook(
      () => useFilterParams(),
      { wrapper: wrapper('/test?page=5') },
    );
    expect(result.current.pagination.page).toBe(5);

    act(() => result.current.pagination.setPageSize(50));

    expect(result.current.pagination.page).toBe(1);
    expect(result.current.pagination.pageSize).toBe(50);
  });

  it('totalPages computes correctly', () => {
    const { result } = renderHook(
      () => useFilterParams({ pageSize: 10 }),
      { wrapper: wrapper() },
    );
    expect(result.current.pagination.totalPages(0)).toBe(1);
    expect(result.current.pagination.totalPages(10)).toBe(1);
    expect(result.current.pagination.totalPages(11)).toBe(2);
    expect(result.current.pagination.totalPages(100)).toBe(10);
  });

  it('computes offset from page and pageSize', () => {
    const { result } = renderHook(
      () => useFilterParams({ pageSize: 10 }),
      { wrapper: wrapper('/test?page=4') },
    );
    expect(result.current.pagination.offset).toBe(30);
  });

  // ── Pagination-only mode ──────────────────────────────────────────────────

  it('works with no filters config', () => {
    const { result } = renderHook(
      () => useFilterParams(),
      { wrapper: wrapper('/test?page=2') },
    );
    expect(result.current.filters).toEqual({});
    expect(result.current.pagination.page).toBe(2);
  });

  // ── Invalid URL values ────────────────────────────────────────────────────

  it('handles invalid page values gracefully', () => {
    const { result } = renderHook(
      () => useFilterParams(),
      { wrapper: wrapper('/test?page=abc') },
    );
    expect(result.current.pagination.page).toBe(1);
  });
});
