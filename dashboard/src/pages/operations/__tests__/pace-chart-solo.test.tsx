import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { PaceChart, type ChartStation } from '../PaceChart';

// A single-station sequence yields one point per curve. Each curve still
// renders a stroke — a short segment centered through the point — so the
// dots and end labels are anchored in vertical space instead of floating.
describe('PaceChart — single station', () => {
  const station: ChartStation = {
    role: 'solo-station',
    title: 'Solo',
    parent_role: null,
    target_per_hour: 10,
    upstream_roles: [],
    metric: {
      role: 'solo-station',
      pending: 3,
      claimed: 1,
      resolved: 5,
      priority_count: 0,
      throughput_pct: 50,
      wait: { p99: 1, avg: 1 },
      work: { p99: 1, avg: 1 },
    } as any,
  };

  it('renders line segments (not bare move commands) through the solo point', () => {
    const { container } = render(
      <PaceChart
        stations={[station]}
        selectedRole={null}
        onSelect={() => {}}
        periodHours={1}
      />,
    );

    const strokedPaths = [...container.querySelectorAll('path')]
      .map((p) => p.getAttribute('d') ?? '')
      .filter((d) => d.startsWith('M'));
    expect(strokedPaths.length).toBeGreaterThan(0);

    // Every single-point curve draws M x y L x' y — a real segment.
    const segments = strokedPaths.filter((d) => d.includes('L'));
    expect(segments.length).toBeGreaterThan(0);

    // The segment is horizontal and centered: both endpoints share y, and the
    // solo point (x = ML + chartW/2 = 382) bisects them.
    const target = segments[0];
    const nums = target.match(/-?\d+(\.\d+)?/g)!.map(Number);
    const [x1, y1, x2, y2] = nums;
    expect(y1).toBe(y2);
    expect((x1 + x2) / 2).toBeCloseTo(382, 0);
    expect(x2 - x1).toBe(18); // slightly longer than an em dash
  });
});
