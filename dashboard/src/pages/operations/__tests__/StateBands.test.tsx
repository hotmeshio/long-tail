import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import type { AggregateRow } from '../../../api/escalation-analytics';
import { StateBand } from '../StateBands';

const row = (state: string, dwellSeconds: number): AggregateRow =>
  ({ state, facets: {}, dwellSeconds }) as AggregateRow;

// colors is built in dwell-rank order: idle → printing → harvest.
const colors = new Map([
  ['idle', 'rgb(1,1,1)'],
  ['printing', 'rgb(2,2,2)'],
  ['harvest', 'rgb(3,3,3)'],
]);

describe('StateBand segment order', () => {
  it('renders segments in the global color order, not the band\'s dominant-first order', () => {
    // This row is dominated by harvest, then printing, then idle — the OPPOSITE
    // of the global order. The band must still lead with idle.
    const { container } = render(
      <StateBand
        groups={[row('harvest', 900), row('printing', 300), row('idle', 100)]}
        colors={colors}
        height="h-2"
      />,
    );
    const titles = [...container.querySelectorAll('[title]')].map((el) =>
      (el.getAttribute('title') ?? '').split(' · ')[0],
    );
    expect(titles).toEqual(['idle', 'printing', 'harvest']);
  });

  it('places unknown states (absent from the color map) last', () => {
    const { container } = render(
      <StateBand groups={[row('mystery', 500), row('idle', 100)]} colors={colors} height="h-2" />,
    );
    const titles = [...container.querySelectorAll('[title]')].map((el) =>
      (el.getAttribute('title') ?? '').split(' · ')[0],
    );
    expect(titles).toEqual(['idle', 'mystery']);
  });

  it('shows each segment as a percent of its peers, not an aggregate', () => {
    const { container } = render(
      <StateBand groups={[row('idle', 750), row('printing', 250)]} colors={colors} height="h-2" />,
    );
    const titles = [...container.querySelectorAll('[title]')].map((el) => el.getAttribute('title'));
    expect(titles).toEqual(['idle · 75%', 'printing · 25%']);
  });
});
