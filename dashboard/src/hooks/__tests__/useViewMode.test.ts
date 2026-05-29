import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';
import { useViewMode } from '../useViewMode';

describe('useViewMode', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('defaults to the provided default when no stored value', () => {
    const { result } = renderHook(() => useViewMode(true));
    expect(result.current.isDevMode).toBe(true);
  });

  it('defaults to false when defaultDevMode is false', () => {
    const { result } = renderHook(() => useViewMode(false));
    expect(result.current.isDevMode).toBe(false);
  });

  it('toggles between dev and user mode', () => {
    const { result } = renderHook(() => useViewMode(true));
    expect(result.current.isDevMode).toBe(true);

    act(() => result.current.toggleMode());
    expect(result.current.isDevMode).toBe(false);

    act(() => result.current.toggleMode());
    expect(result.current.isDevMode).toBe(true);
  });

  it('persists preference to localStorage', () => {
    const { result } = renderHook(() => useViewMode(true));

    act(() => result.current.toggleMode());
    expect(localStorage.getItem('lt_view_mode')).toBe('user');

    act(() => result.current.toggleMode());
    expect(localStorage.getItem('lt_view_mode')).toBe('dev');
  });

  it('restores preference from localStorage', () => {
    localStorage.setItem('lt_view_mode', 'user');
    const { result } = renderHook(() => useViewMode(true));
    expect(result.current.isDevMode).toBe(false);
  });

  it('restores dev preference from localStorage', () => {
    localStorage.setItem('lt_view_mode', 'dev');
    const { result } = renderHook(() => useViewMode(false));
    expect(result.current.isDevMode).toBe(true);
  });
});
