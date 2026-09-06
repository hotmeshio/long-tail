import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { AggregateRow } from '../../../api/escalation-analytics';
import { MixSummary } from '../MixSummary';

const row = (state: string, dwellSeconds: number): AggregateRow =>
  ({ state, facets: {}, dwellSeconds }) as AggregateRow;

const colors = new Map([['a', 'rgb(1,1,1)'], ['b', 'rgb(2,2,2)'], ['c', 'rgb(3,3,3)']]);
const label = (s: string | undefined) => s ?? '—';

describe('MixSummary', () => {
  it('ranks stages by share, leader first, each labelled with its percent', () => {
    render(
      <MixSummary
        groups={[row('b', 200), row('a', 600), row('c', 200)]}
        colors={colors}
        stateLabel={label}
        nowByState={new Map()}
        periodHours={24}
        tracked={5}
        entityKey="order_id"
      />,
    );
    const bars = screen.getAllByTitle(/·/).map((el) => el.getAttribute('title'));
    expect(bars[0]).toContain('a · 60%');
    expect(bars[1]).toContain('b · 20%');
    expect(bars[2]).toContain('c · 20%');
  });

  it('leads the insight with the biggest sink, stage count, and queue depth', () => {
    const { container } = render(
      <MixSummary
        groups={[row('a', 600), row('b', 400)]}
        colors={colors}
        stateLabel={label}
        nowByState={new Map()}
        periodHours={24}
        tracked={5}
        entityKey="order_id"
      />,
    );
    expect(container.textContent).toContain('Last 24h');
    expect(container.textContent).toContain('is the biggest time sink');
    expect(container.textContent).toContain('across 2 stages');
    expect(container.textContent).toContain('5');
    expect(container.textContent).toContain('in queue now');
  });

  it('folds the tail into a bounded "+N more" line, never a long list', () => {
    const many = Array.from({ length: 13 }, (_, i) => row(`s${i}`, 13 - i));
    render(
      <MixSummary
        groups={many}
        colors={new Map()}
        stateLabel={label}
        nowByState={new Map()}
        periodHours={1}
        tracked={0}
        entityKey="x"
      />,
    );
    expect(screen.getByText('+3 more stages')).toBeInTheDocument();
  });
});
