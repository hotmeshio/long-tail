import { describe, it, expect, vi, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import { PaceChart, viewBoxWidth, type ChartStation } from '../PaceChart';

// A fill-mode chart shapes its coordinate space to the box it is given: a
// wide, short panel widens the viewBox so stations spread edge to edge.

const stations: ChartStation[] = ['a', 'b', 'c'].map((role) => ({
  role,
  title: role.toUpperCase(),
  target_per_hour: 40,
  parent_role: null,
  metric: undefined,
}));

/** A ResizeObserver that reports one fixed box the moment it observes. */
function fakeResizeObserver(width: number, height: number) {
  return class {
    private cb: ResizeObserverCallback;
    constructor(cb: ResizeObserverCallback) { this.cb = cb; }
    observe() { this.cb([{ contentRect: { width, height } } as ResizeObserverEntry], this as unknown as ResizeObserver); }
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

afterEach(() => vi.unstubAllGlobals());

describe('viewBoxWidth', () => {
  it('keeps the designed width without a box, outside fill mode, or for a tall box', () => {
    expect(viewBoxWidth(null, true)).toBe(800);
    expect(viewBoxWidth({ width: 3000, height: 300 }, false)).toBe(800);
    expect(viewBoxWidth({ width: 400, height: 300 }, true)).toBe(800);
    expect(viewBoxWidth({ width: 1000, height: 0 }, true)).toBe(800);
  });

  it('widens with the box aspect so the drawing fills a wide, short panel', () => {
    expect(viewBoxWidth({ width: 1600, height: 270 }, true)).toBe(1600);
    expect(viewBoxWidth({ width: 3000, height: 500 }, true)).toBe(1620);
  });
});

describe('PaceChart fill mode', () => {
  it('spreads the stations across the measured width', () => {
    vi.stubGlobal('ResizeObserver', fakeResizeObserver(1600, 270));
    const { container } = render(
      <PaceChart stations={stations} selectedRole={null} onSelect={() => {}} periodHours={1} fill />,
    );
    const svg = container.querySelector('svg')!;
    expect(svg.getAttribute('viewBox')).toBe('0 0 1600 270');
    const labels = [...container.querySelectorAll('text')].filter((t) => ['A', 'B', 'C'].includes(t.textContent ?? ''));
    const xs = labels.map((t) => Number(t.getAttribute('x')));
    expect(xs[0]).toBe(28);
    expect(xs[2]).toBe(1600 - 60);
  });

  it('keeps the designed space when the box is taller than the drawing', () => {
    vi.stubGlobal('ResizeObserver', fakeResizeObserver(600, 600));
    const { container } = render(
      <PaceChart stations={stations} selectedRole={null} onSelect={() => {}} periodHours={1} fill />,
    );
    expect(container.querySelector('svg')!.getAttribute('viewBox')).toBe('0 0 800 270');
  });
});
