import { renderHook, act } from '@testing-library/react';
import { usePagination } from '../usePagination';

describe('usePagination', () => {
  it('initializes with default page size of 25', () => {
    const { result } = renderHook(() => usePagination());
    expect(result.current.page).toBe(1);
    expect(result.current.pageSize).toBe(25);
    expect(result.current.offset).toBe(0);
  });

  it('accepts a custom initial page size', () => {
    const { result } = renderHook(() => usePagination(50));
    expect(result.current.pageSize).toBe(50);
  });

  it('computes offset from page and pageSize', () => {
    const { result } = renderHook(() => usePagination(10));
    act(() => result.current.setPage(3));
    expect(result.current.offset).toBe(20);
  });

  it('resets page to 1 when pageSize changes', () => {
    const { result } = renderHook(() => usePagination(10));
    act(() => result.current.setPage(5));
    expect(result.current.page).toBe(5);

    act(() => result.current.setPageSize(25));
    expect(result.current.page).toBe(1);
    expect(result.current.pageSize).toBe(25);
  });

  it('computes totalPages correctly', () => {
    const { result } = renderHook(() => usePagination(10));
    expect(result.current.totalPages(0)).toBe(1);
    expect(result.current.totalPages(10)).toBe(1);
    expect(result.current.totalPages(11)).toBe(2);
    expect(result.current.totalPages(100)).toBe(10);
  });
});
