import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StationMixBar } from '../StationMixBar';
import { assignMixColors, NO_SUBTYPE_LABEL } from '../mix-colors';
import type { AggregateRow } from '../../../api/escalation-analytics';

function makeGroups(): AggregateRow[] {
  return [
    { subtype: 'printing', facets: {}, sampleCount: 3, dwellSeconds: 750 },
    { subtype: 'ready', facets: {}, sampleCount: 2, dwellSeconds: 250 },
  ];
}

/** The segment strip is the first child of the titled wrapper. */
function segmentsOf(container: HTMLElement): HTMLElement[] {
  const bar = container.querySelector('div[title] > div') as HTMLElement;
  return Array.from(bar.children) as HTMLElement[];
}

describe('StationMixBar', () => {
  it('renders one segment per state with widths proportional to dwell', () => {
    const groups = makeGroups();
    const { container } = render(
      <StationMixBar groups={groups} colors={assignMixColors(groups)} />,
    );
    const segments = segmentsOf(container);
    expect(segments).toHaveLength(2);
    // Sorted by dwell descending: printing (750/1000) then ready (250/1000).
    expect(segments[0].style.width).toBe('75%');
    expect(segments[1].style.width).toBe('25%');
  });

  it('shows the dominant share beside the bar and the full breakdown in the tooltip', () => {
    const groups = makeGroups();
    const { container } = render(
      <StationMixBar groups={groups} colors={assignMixColors(groups)} />,
    );
    expect(screen.getByText('75%')).toBeInTheDocument();
    const tooltip = (container.querySelector('div[title]') as HTMLElement).title;
    expect(tooltip).toContain('printing');
    expect(tooltip).toContain('ready');
    expect(tooltip).toContain('25%');
  });

  it('assigns each segment its state color', () => {
    const groups = makeGroups();
    const colors = assignMixColors(groups);
    const { container } = render(<StationMixBar groups={groups} colors={colors} />);
    const segments = segmentsOf(container);
    expect(segments[0].style.backgroundColor).toBe(colors.get('printing'));
    expect(segments[1].style.backgroundColor).toBe(colors.get('ready'));
  });

  it('drops zero-dwell groups from the strip', () => {
    const groups: AggregateRow[] = [
      ...makeGroups(),
      { subtype: 'idle', facets: {}, sampleCount: 1, dwellSeconds: 0 },
    ];
    const { container } = render(
      <StationMixBar groups={groups} colors={assignMixColors(groups)} />,
    );
    expect(segmentsOf(container)).toHaveLength(2);
  });

  it('labels the null-subtype group rather than dropping it', () => {
    const groups: AggregateRow[] = [
      { subtype: null, facets: {}, sampleCount: 1, dwellSeconds: 100 },
    ];
    const { container } = render(
      <StationMixBar groups={groups} colors={assignMixColors(groups)} />,
    );
    expect(segmentsOf(container)).toHaveLength(1);
    const tooltip = (container.querySelector('div[title]') as HTMLElement).title;
    expect(tooltip).toContain(NO_SUBTYPE_LABEL);
  });

  it('renders a dash when there is no data', () => {
    render(<StationMixBar groups={undefined} colors={new Map()} />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('renders a dash when every group has zero dwell', () => {
    const groups: AggregateRow[] = [
      { subtype: 'ready', facets: {}, sampleCount: 1, dwellSeconds: 0 },
    ];
    render(<StationMixBar groups={groups} colors={assignMixColors(groups)} />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });
});
