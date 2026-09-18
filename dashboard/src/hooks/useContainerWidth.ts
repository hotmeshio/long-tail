import { useCallback, useEffect, useState } from 'react';

/**
 * Measures an element's content-box width via ResizeObserver — the hook form
 * of "geometry follows the container". Returns a CALLBACK ref (the observed
 * element can mount late, e.g. after a loading state) and the width: `null`
 * before the first measure and in environments without ResizeObserver
 * (jsdom), which callers treat as "wide".
 */
export function useContainerWidth<T extends HTMLElement>(): [(node: T | null) => void, number | null] {
  const [el, setEl] = useState<T | null>(null);
  const [width, setWidth] = useState<number | null>(null);

  const ref = useCallback((node: T | null) => setEl(node), []);

  useEffect(() => {
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setWidth(entry.contentRect.width);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [el]);

  return [ref, width];
}

export interface ContainerSize {
  width: number;
  height: number;
}

/**
 * Both content-box dimensions of an element, for drawings that shape
 * themselves to the box they fill rather than to a fixed aspect. Same
 * contract as useContainerWidth: a callback ref and `null` before the first
 * measure or without ResizeObserver.
 */
export function useContainerSize<T extends HTMLElement>(): [(node: T | null) => void, ContainerSize | null] {
  const [el, setEl] = useState<T | null>(null);
  const [size, setSize] = useState<ContainerSize | null>(null);

  const ref = useCallback((node: T | null) => setEl(node), []);

  useEffect(() => {
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [el]);

  return [ref, size];
}
