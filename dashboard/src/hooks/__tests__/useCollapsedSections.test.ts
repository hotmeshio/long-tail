import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';
import { useCollapsedSections } from '../useCollapsedSections';

const PAGE_KEY = 'test-page';

describe('useCollapsedSections', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('starts with no sections collapsed', () => {
    const { result } = renderHook(() => useCollapsedSections(PAGE_KEY));
    expect(result.current.isCollapsed('foo')).toBe(false);
  });

  it('toggle collapses a section', () => {
    const { result } = renderHook(() => useCollapsedSections(PAGE_KEY));

    act(() => result.current.toggle('context'));
    expect(result.current.isCollapsed('context')).toBe(true);
  });

  it('toggle expands a collapsed section', () => {
    const { result } = renderHook(() => useCollapsedSections(PAGE_KEY));

    act(() => result.current.toggle('context'));
    act(() => result.current.toggle('context'));
    expect(result.current.isCollapsed('context')).toBe(false);
  });

  it('collapse forces a section closed', () => {
    const { result } = renderHook(() => useCollapsedSections(PAGE_KEY));

    act(() => result.current.collapse('triage'));
    expect(result.current.isCollapsed('triage')).toBe(true);
  });

  it('collapse is idempotent on already-collapsed section', () => {
    const { result } = renderHook(() => useCollapsedSections(PAGE_KEY));

    act(() => result.current.collapse('triage'));
    act(() => result.current.collapse('triage'));
    expect(result.current.isCollapsed('triage')).toBe(true);
  });

  it('expand forces a section open', () => {
    const { result } = renderHook(() => useCollapsedSections(PAGE_KEY));

    act(() => result.current.collapse('resolver'));
    expect(result.current.isCollapsed('resolver')).toBe(true);

    act(() => result.current.expand('resolver'));
    expect(result.current.isCollapsed('resolver')).toBe(false);
  });

  it('expand is idempotent on already-open section', () => {
    const { result } = renderHook(() => useCollapsedSections(PAGE_KEY));

    act(() => result.current.expand('resolver'));
    expect(result.current.isCollapsed('resolver')).toBe(false);
  });

  it('persists to localStorage', () => {
    const { result } = renderHook(() => useCollapsedSections(PAGE_KEY));

    act(() => result.current.collapse('a'));
    act(() => result.current.collapse('b'));

    const stored = JSON.parse(localStorage.getItem(`lt-collapsed-sections:${PAGE_KEY}`)!);
    expect(stored).toContain('a');
    expect(stored).toContain('b');
  });

  it('restores from localStorage', () => {
    localStorage.setItem(`lt-collapsed-sections:${PAGE_KEY}`, JSON.stringify(['x', 'y']));
    const { result } = renderHook(() => useCollapsedSections(PAGE_KEY));

    expect(result.current.isCollapsed('x')).toBe(true);
    expect(result.current.isCollapsed('y')).toBe(true);
    expect(result.current.isCollapsed('z')).toBe(false);
  });
});
