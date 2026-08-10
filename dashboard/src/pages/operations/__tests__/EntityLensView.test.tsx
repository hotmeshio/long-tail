import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import type { AggregateByFacetsInput } from '../../../api/escalation-analytics';

// Row ⌘-click navigates to the all-queues facet search; spy the navigator.
const mockNavigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router-dom')>()),
  useNavigate: () => mockNavigate,
}));

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

// The slice aggregate: state dwell grouped by the categorical facet (no anyOf).
const SLICE_PAGE = {
  groups: [
    { state: 'print', facets: { facility: 'solo' }, dwellSeconds: 600, sampleCount: 3 },
    { state: 'print', facets: { facility: 'solitude' }, dwellSeconds: 300, sampleCount: 2 },
  ],
  overflow: false,
};

function isEntityRank(input: AggregateByFacetsInput | null): boolean {
  return !!input && input.measure.kind === 'dwell'
    && input.groupBy.facets?.[0] === 'serialNumber' && !input.groupBy.state;
}

function isEntityStates(input: AggregateByFacetsInput | null): boolean {
  return !!input && input.measure.kind === 'dwell'
    && input.groupBy.state === true && !!input.query.anyOf;
}

function isSlice(input: AggregateByFacetsInput | null): boolean {
  return !!input && input.measure.kind === 'dwell'
    && input.groupBy.state === true && input.groupBy.facets?.[0] === 'facility' && !input.query.anyOf;
}

function installAggregates() {
  mockUseAggregateByFacets.mockImplementation((input: AggregateByFacetsInput | null) => {
    if (!input) return { data: undefined, error: null, isLoading: false };
    if (isSlice(input)) {
      return { data: SLICE_PAGE, error: null, isLoading: false };
    }
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
const onSliceKeyChange = vi.fn();
const onSliceValueChange = vi.fn();

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
      onSliceKeyChange={onSliceKeyChange}
      onSliceValueChange={onSliceValueChange}
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

  it('⌘-click on a row searches every queue for the facet value (not the panel)', () => {
    renderLens();
    fireEvent.click(screen.getByText('SN-1'), { metaKey: true });
    expect(mockNavigate).toHaveBeenCalledTimes(1);
    const target = mockNavigate.mock.calls[0][0] as string;
    expect(target).toContain('/escalations/available?');
    expect(target).toContain(encodeURIComponent(JSON.stringify({ serialNumber: 'SN-1' })));
    expect(target).toContain('status=all');
    expect(target).toContain('view=table');
    // Most recent activity first — the dashboard default.
    expect(target).toContain(encodeURIComponent(JSON.stringify([{ field: 'created_at', direction: 'desc' }])));
    expect(onEntityChange).not.toHaveBeenCalled();
  });

  it('keeps the History affordance as the same deep-link action', () => {
    renderLens();
    fireEvent.click(screen.getAllByTitle(/open timeline/i)[1]);
    expect(onEntityChange).toHaveBeenCalledWith('SN-2');
  });
});

describe('EntityLensView slice modes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dwellOverflow = false;
    installAggregates();
  });

  const scopedRanks = (): AggregateByFacetsInput[] =>
    mockUseAggregateByFacets.mock.calls
      .map((c) => c[0] as AggregateByFacetsInput | null)
      .filter((i): i is AggregateByFacetsInput => isEntityRank(i) && !!i!.query.equals);

  it('compare mode renders one column per slice value, each ranked by a per-value equality scope', () => {
    renderLens({ sliceKey: 'facility' });
    // Column headers center-ellipsize long values, so match on the full-value title.
    expect(screen.getByTitle('solo')).toBeInTheDocument();
    expect(screen.getByTitle('solitude')).toBeInTheDocument();
    // Scope is an exact text match (round-trips the aggregate's text value),
    // never a jsonb-containment anyOf that would miss booleans/numbers.
    const facilities = scopedRanks().map((i) => (i.query.equals as Record<string, string>).facility);
    expect(facilities).toContain('solo');
    expect(facilities).toContain('solitude');
    expect(scopedRanks().every((i) => i.query.anyOf === undefined)).toBe(true);
    // The compare grid is a bounded snapshot — never paginated.
    expect(screen.queryByText('Prev')).not.toBeInTheDocument();
  });

  it('compare columns pull a bounded top-K, not an offset page', () => {
    renderLens({ sliceKey: 'facility' });
    expect(scopedRanks()[0].limit).toBe(15);
    expect(scopedRanks()[0].offset).toBeUndefined();
  });

  it('focus mode scopes the paginated ranking to the targeted value and restores the pager', () => {
    renderLens({ sliceKey: 'facility', sliceValue: 'solo' });
    const rank = lastRank();
    expect(rank.query.equals).toEqual({ facility: 'solo' });
    expect(rank).toMatchObject({ groupBy: { facets: ['serialNumber'] }, limit: 50, offset: 0 });
    expect(screen.getByText('Prev')).toBeInTheDocument();
    expect(screen.getByText(/all facility/)).toBeInTheDocument();
  });

  it('the page-size selector drives the ranking limit', () => {
    renderLens({ sliceKey: 'facility', sliceValue: 'solo' });
    fireEvent.change(screen.getByLabelText('Results per page'), { target: { value: '100' } });
    expect(lastRank().limit).toBe(100);
  });
});
