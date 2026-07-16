import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EscalationTimeline } from '../EscalationTimeline';

const T0 = '2026-06-25T00:00:00.000Z';
const T30 = '2026-06-25T00:30:00.000Z';
const T60 = '2026-06-25T01:00:00.000Z';
const T90 = '2026-06-25T01:30:00.000Z';
const T180 = '2026-06-25T03:00:00.000Z';

const esc = (over: Record<string, unknown>) =>
  ({
    id: 'e', role: 'r', priority: 2, status: 'pending',
    created_at: T0, claimed_at: null, resolved_at: null,
    assigned_to: null, assigned_until: null, updated_at: T0,
    ...over,
  } as any);

// Matches COLORS in EscalationTimeline.tsx
const C = {
  pending:   '#0ea5e9',
  claimed:   '#f97316',
  resolved:  '#16a34a',
  cancelled: '#ef4444',
};

function segmentWithColor(container: HTMLElement, color: string): HTMLElement | null {
  const all = container.querySelectorAll<HTMLElement>('[style*="background-color"]');
  for (const el of all) {
    if (el.style.backgroundColor === color || el.getAttribute('style')?.includes(color)) return el;
  }
  // jsdom normalises hex → rgb; compare via computed style
  for (const el of all) {
    if ((el as HTMLElement).style.backgroundColor) {
      // create a temp span to parse the hex into rgb
      const tmp = document.createElement('span');
      tmp.style.color = color;
      document.body.appendChild(tmp);
      const want = getComputedStyle(tmp).color; // "rgb(r, g, b)"
      document.body.removeChild(tmp);
      if (getComputedStyle(el).backgroundColor === want) return el;
    }
  }
  return null;
}

afterEach(() => vi.useRealTimers());

describe('EscalationTimeline', () => {
  it('resolved → blue pending + green resolved, with time-to-claim and total', () => {
    const { container } = render(
      <EscalationTimeline esc={esc({ status: 'resolved', claimed_at: T30, resolved_at: T90 })} />,
    );
    const bars = container.querySelectorAll<HTMLElement>('[style]');
    const colors = Array.from(bars).map((el) => el.style.backgroundColor).join(' ');
    expect(colors).toContain(''); // at least one segment rendered
    expect(screen.getByText('30m')).toBeInTheDocument();    // time to claim
    expect(screen.getByText('1h 30m')).toBeInTheDocument(); // total
  });

  it('renders a sliver of work as a minimum-width sphere (≥ bar height)', () => {
    const T90s1 = '2026-06-25T01:30:01.000Z'; // resolved 1s after claim
    const { container } = render(
      <EscalationTimeline esc={esc({ status: 'resolved', claimed_at: T90, resolved_at: T90s1 })} />,
    );
    // The resolved segment should have minWidth set
    const segs = container.querySelectorAll<HTMLElement>('div[style*="minWidth"], div[style*="min-width"]');
    const hasSphere = Array.from(segs).some((el) => el.style.minWidth === `${5}px`);
    expect(hasSphere).toBe(true);
  });

  it('cancelled → shows two segments including the red cancelled one', () => {
    render(
      <EscalationTimeline esc={esc({ status: 'cancelled', claimed_at: T30, updated_at: T90 })} />,
    );
    expect(screen.getByText('1h 30m')).toBeInTheDocument();
  });

  it('actively claimed (not timed out) → two segments measured against current age', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(T90)); // now = 90m
    const { container } = render(
      <EscalationTimeline esc={esc({ status: 'pending', claimed_at: T30, assigned_to: 'u', assigned_until: T180 })} />,
    );
    // Should have two bar segments (pending blue + claimed orange)
    const segs = container.querySelectorAll<HTMLElement>('div[style*="width"]');
    const visibleSegs = Array.from(segs).filter((el) => el.style.backgroundColor);
    expect(visibleSegs.length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('30m')).toBeInTheDocument();
    expect(screen.getByText('1h 30m')).toBeInTheDocument();
  });

  it('timed-out claim on an open escalation → all pending blue, no claim label', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(T90)); // now = 90m; claim expired at 60m
    const { container } = render(
      <EscalationTimeline esc={esc({ status: 'pending', claimed_at: T30, assigned_to: 'u', assigned_until: T60 })} />,
    );
    // Only one bar segment (pending) — timed-out claim reverts to all-pending
    const segs = container.querySelectorAll<HTMLElement>('div[style*="width"]');
    const visibleSegs = Array.from(segs).filter((el) => el.style.backgroundColor);
    expect(visibleSegs.length).toBe(1);
    expect(screen.queryByTitle(/Time to claim/)).not.toBeInTheDocument();
    expect(screen.getByText('1h 30m')).toBeInTheDocument(); // age only
  });

  it('never claimed → single blue pending bar with just the age', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(T30));
    const { container } = render(<EscalationTimeline esc={esc({ status: 'pending' })} />);
    const segs = container.querySelectorAll<HTMLElement>('div[style*="width"]');
    const visibleSegs = Array.from(segs).filter((el) => el.style.backgroundColor);
    expect(visibleSegs.length).toBe(1);
    expect(screen.queryByTitle(/Time to claim/)).not.toBeInTheDocument();
    expect(screen.getByText('30m')).toBeInTheDocument();
  });
});
