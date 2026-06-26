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

afterEach(() => vi.useRealTimers());

describe('EscalationTimeline', () => {
  it('resolved → amber waiting + green worked, with time-to-claim and total', () => {
    const { container } = render(
      <EscalationTimeline esc={esc({ status: 'resolved', claimed_at: T30, resolved_at: T90 })} />,
    );
    expect(container.querySelector('.bg-status-success')).toBeTruthy(); // green outcome
    expect(container.querySelector('.bg-status-active')).toBeNull();
    expect(screen.getByText('30m')).toBeInTheDocument();    // time to claim
    expect(screen.getByText('1h 30m')).toBeInTheDocument(); // total
  });

  it('renders a sliver of work as a minimum-width sphere (≥ bar height)', () => {
    const T90s1 = '2026-06-25T01:30:01.000Z'; // resolved 1s after claim
    const { container } = render(
      <EscalationTimeline esc={esc({ status: 'resolved', claimed_at: T90, resolved_at: T90s1 })} />,
    );
    const green = container.querySelector('.bg-status-success') as HTMLElement;
    expect(green).toBeTruthy();
    expect(green.style.minWidth).toBe('4px'); // tiny worked span still visible
  });

  it('cancelled → amber waiting + red segment', () => {
    const { container } = render(
      <EscalationTimeline esc={esc({ status: 'cancelled', claimed_at: T30, updated_at: T90 })} />,
    );
    expect(container.querySelector('.bg-status-error')).toBeTruthy();
    expect(screen.getByText('1h 30m')).toBeInTheDocument();
  });

  it('actively claimed (not timed out) → amber + blue, measured against current age', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(T90)); // now = 90m
    const { container } = render(
      <EscalationTimeline esc={esc({ status: 'pending', claimed_at: T30, assigned_to: 'u', assigned_until: T180 })} />,
    );
    expect(container.querySelector('.bg-status-active')).toBeTruthy(); // blue in-progress
    expect(screen.getByText('30m')).toBeInTheDocument();
    expect(screen.getByText('1h 30m')).toBeInTheDocument();
  });

  it('timed-out claim on an open escalation → all amber, no outcome segment or claim label', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(T90)); // now = 90m; claim expired at 60m
    const { container } = render(
      <EscalationTimeline esc={esc({ status: 'pending', claimed_at: T30, assigned_to: 'u', assigned_until: T60 })} />,
    );
    expect(container.querySelector('.bg-status-active')).toBeNull();
    expect(container.querySelector('.bg-status-success')).toBeNull();
    expect(screen.queryByTitle(/Time to claim/)).not.toBeInTheDocument();
    expect(screen.getByText('1h 30m')).toBeInTheDocument(); // age only
  });

  it('never claimed → all amber with just the age', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(T30));
    const { container } = render(<EscalationTimeline esc={esc({ status: 'pending' })} />);
    expect(container.querySelector('.bg-status-active')).toBeNull();
    expect(screen.queryByTitle(/Time to claim/)).not.toBeInTheDocument();
    expect(screen.getByText('30m')).toBeInTheDocument();
  });
});
