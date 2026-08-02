import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import type { AggregateByFacetsInput } from '../../../api/escalation-analytics';

// ── Mocks — the analytics hooks are the lens's only data sources ─────────────

const mockUseAggregateByFacets = vi.fn();
vi.mock('../../../api/escalation-analytics', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../api/escalation-analytics')>();
  return {
    ...actual,
    useAggregateByFacets: (...args: unknown[]) => mockUseAggregateByFacets(...args),
    useAnalyticsWindow: () => ({ from: '2026-08-01T09:00:00.000Z', to: '2026-08-01T10:00:00.000Z' }),
    isForbidden: () => false,
  };
});
vi.mock('../../../api/escalations', () => ({
  useFacetKeys: () => ({ data: { keys: [] } }),
}));
vi.mock('../../../hooks/useShellPanel', () => ({
  useShellPanelOptional: () => null,
}));
vi.mock('../../../components/escalation/EntityTimelinePanel', () => ({
  EntityTimelinePanel: () => null,
}));

import { EntityLensView } from '../EntityLensView';

// ── Fixtures ──────────────────────────────────────────────────────────────────

// The RANKING page: one row per entity, ordered by total tracked time.
const RANK_PAGE = {
  groups: [
    { facets: { serialNumber: 'SN-1' }, dwellSeconds: 900, sampleCount: 5 },
    { facets: { serialNumber: 'SN-2' }, dwellSeconds: 200, sampleCount: 1 },
  ],
  overflow: false,
};

// The page's state splits, anyOf-targeted.
const STATE_PAGE = {
  groups: [
    { state: 'print', facets: { serialNumber: 'SN-1' }, dwellSeconds: 600, sampleCount: 3 },
    { state: 'assembly', facets: { serialNumber: 'SN-1' }, dwellSeconds: 300, sampleCount: 2 },
    { state: 'print', facets: { serialNumber: 'SN-2' }, dwellSeconds: 200, sampleCount: 1 },
  ],
  overflow: false,
};

let dwellOverflow = false;

function isEntityRank(input: AggregateByFacetsInput | null): boolean {
  return !!input && input.measure.kind === 'dwell'
    && input.groupBy.facets?.[0] === 'serialNumber' && !input.groupBy.state;
}

function isEntityStates(input: AggregateByFacetsInput | null): boolean {
  return !!input && input.measure.kind === 'dwell'
    && input.groupBy.state === true && !!input.query.anyOf;
}

function installAggregates() {
  mockUseAggregateByFacets.mockImplementation((input: AggregateByFacetsInput | null) => {
    if (!input) return { data: undefined, error: null, isLoading: false };
    if (isEntityRank(input)) {
      return { data: { ...RANK_PAGE, overflow: dwellOverflow }, error: null, isLoading: false };
    }
    if (isEntityStates(input)) {
      return { data: STATE_PAGE, error: null, isLoading: false };
    }
    return { data: { groups: [], overflow: false }, error: null, isLoading: false };
  });
}

const onFindChange = vi.fn();
const onEntityChange = vi.fn();

function renderLens(overrides?: Partial<Parameters<typeof EntityLensView>[0]>) {
  return render(
    <EntityLensView
      entityKey="serialNumber"
      periodHours={1}
      roles={[]}
      find={null}
      onFindChange={onFindChange}
      entityValue={null}
      onEntityChange={onEntityChange}
      {...overrides}
    />,
  );
}

const rankCalls = (): AggregateByFacetsInput[] =>
  mockUseAggregateByFacets.mock.calls.map((c) => c[0]).filter(isEntityRank);
const lastRank = (): AggregateByFacetsInput => rankCalls()[rankCalls().length - 1];

describe('EntityLensView entity table', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dwellOverflow = false;
    installAggregates();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('ranks one page of ENTITIES server-side (facet-only grouping, total-dwell order)', () => {
    renderLens();
    expect(lastRank()).toMatchObject({
      query: { entity: 'serialNumber' },
      groupBy: { facets: ['serialNumber'] },
      orderBy: [{ field: 'dwellSeconds', direction: 'desc' }],
      limit: 50,
      offset: 0,
    });
    expect(lastRank().groupBy.state).toBeUndefined();
    expect(lastRank().query.prefix).toBeUndefined();
  });

  it("fills the page's bands via an anyOf-targeted state-split query", () => {
    renderLens();
    const states = mockUseAggregateByFacets.mock.calls
      .map((c) => c[0] as AggregateByFacetsInput | null)
      .find(isEntityStates);
    expect(states!.query.anyOf).toEqual([{ serialNumber: 'SN-1' }, { serialNumber: 'SN-2' }]);
    expect(states!.groupBy).toEqual({ state: true, facets: ['serialNumber'] });
  });

  it('adds the find term as a prefix filter on the dwell query', () => {
    renderLens({ find: 'SN-1' });
    expect(lastRank().query.prefix).toEqual({ serialNumber: 'SN-1' });
  });

  it('debounces the find input into onFindChange', () => {
    vi.useFakeTimers();
    renderLens();
    fireEvent.change(screen.getByLabelText('Find by serialNumber'), {
      target: { value: 'SN-9' },
    });
    act(() => vi.advanceTimersByTime(250));
    expect(onFindChange).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(100));
    expect(onFindChange).toHaveBeenCalledWith('SN-9');
  });

  it('clearing the find input empties the term', () => {
    vi.useFakeTimers();
    renderLens({ find: 'SN-9' });
    fireEvent.change(screen.getByLabelText('Find by serialNumber'), { target: { value: '' } });
    act(() => vi.advanceTimersByTime(350));
    expect(onFindChange).toHaveBeenCalledWith(null);
  });

  it('enables Next only when the dwell page overflows', () => {
    dwellOverflow = false;
    const { unmount } = renderLens();
    expect(screen.getByText('Next')).toBeDisabled();
    unmount();

    dwellOverflow = true;
    renderLens();
    expect(screen.getByText('Next')).toBeEnabled();
    expect(screen.getByText('Prev')).toBeDisabled();
  });

  it('advancing the page offsets the dwell query', () => {
    dwellOverflow = true;
    renderLens();
    fireEvent.click(screen.getByText('Next'));
    expect(lastRank()).toMatchObject({ limit: 50, offset: 50 });
    expect(screen.getByText('page 2')).toBeInTheDocument();
  });

  it('targets the membership query at exactly the visible page via anyOf', () => {
    renderLens();
    const membership = mockUseAggregateByFacets.mock.calls
      .map((c) => c[0] as AggregateByFacetsInput | null)
      .find((i) => i?.measure.kind === 'membership' && !!i.query.anyOf);
    expect(membership).toBeTruthy();
    expect(membership!.query.anyOf).toEqual([{ serialNumber: 'SN-1' }, { serialNumber: 'SN-2' }]);
    expect(membership!.groupBy).toEqual({ state: true, facets: ['serialNumber'] });
  });

  it('deep-links the entity on row click', () => {
    renderLens();
    fireEvent.click(screen.getByText('SN-1'));
    expect(onEntityChange).toHaveBeenCalledWith('SN-1');
  });

  it('keeps the History affordance as the same deep-link action', () => {
    renderLens();
    fireEvent.click(screen.getAllByTitle('Open timeline')[1]);
    expect(onEntityChange).toHaveBeenCalledWith('SN-2');
  });
});
