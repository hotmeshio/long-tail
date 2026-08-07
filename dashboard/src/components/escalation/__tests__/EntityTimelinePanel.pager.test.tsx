import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { TimelineInterval } from '../../../api/escalation-analytics';

// ── Mocks — head page via the hook, earlier pages via the one-shot fetch ─────

const mockUseTimelineByFacet = vi.fn();
const mockFetchTimelineByFacet = vi.fn();
vi.mock('../../../api/escalation-analytics', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../api/escalation-analytics')>();
  return {
    ...actual,
    useTimelineByFacet: (...args: unknown[]) => mockUseTimelineByFacet(...args),
    fetchTimelineByFacet: (...args: unknown[]) => mockFetchTimelineByFacet(...args),
    isForbidden: () => false,
  };
});

vi.mock('../../../hooks/useEventHooks', () => ({
  useEscalationAnalyticsEvents: vi.fn(),
}));

vi.mock('../../../hooks/useShellPanel', () => ({
  useShellPanel: () => ({ closePanel: vi.fn() }),
}));

// The self-serve color hook runs its own analytics queries — out of scope here;
// the injected-resolver path is what these tests exercise.
vi.mock('../../../pages/operations/useEntityStateColors', () => ({
  useEntityStateColors: () => () => undefined,
}));

import { EntityTimelinePanel } from '../EntityTimelinePanel';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const T0 = Date.parse('2026-08-01T10:00:00.000Z');
const iso = (offsetMs: number) => new Date(T0 + offsetMs).toISOString();

function interval(role: string, startMs: number, endMs: number): TimelineInterval {
  return {
    role,
    subtype: null,
    status: 'resolved',
    facets: {},
    startedAt: iso(startMs),
    endedAt: iso(endMs),
    durationSeconds: (endMs - startMs) / 1000,
  };
}

// Head page, newest-first: stationC then stationB. stationA is one page earlier.
const HEAD_DESC = [
  interval('stationC', 2_000_000, 2_600_000),
  interval('stationB', 1_000_000, 1_600_000),
];
const EARLIER_DESC = [interval('stationA', 0, 600_000)];

function setHead(intervalsDesc: TimelineInterval[], overflow: boolean) {
  mockUseTimelineByFacet.mockReturnValue({
    data: { intervals: intervalsDesc, overflow },
    error: null,
    isLoading: false,
  });
}

describe('EntityTimelinePanel pager + copy link', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('hides Load earlier when the head page has no overflow', () => {
    setHead(HEAD_DESC, false);
    render(<EntityTimelinePanel facetKey="serialNumber" value="SN-100" entity="serialNumber" />);
    expect(screen.queryByText('Load earlier')).not.toBeInTheDocument();
  });

  it('colors interval dots from the injected resolver (the graphic\'s exact map)', () => {
    setHead(HEAD_DESC, false);
    // The opener maps a category to the graphic's color; the panel must use it
    // verbatim, not recompute one from its own intervals.
    const injected = (iv: TimelineInterval) => (iv.role === 'stationC' ? 'rgb(1, 2, 3)' : undefined);
    render(
      <EntityTimelinePanel
        facetKey="serialNumber"
        value="SN-100"
        entity="serialNumber"
        intervalColor={injected}
      />,
    );
    // Dot carries its category as title; stationC's dot uses the injected color.
    expect(screen.getByTitle('stationC')).toHaveStyle({ backgroundColor: 'rgb(1, 2, 3)' });
  });

  it('loads earlier intervals with before = oldest loaded and prepends them', async () => {
    setHead(HEAD_DESC, true);
    mockFetchTimelineByFacet.mockResolvedValue({ intervals: EARLIER_DESC, overflow: false });
    render(<EntityTimelinePanel facetKey="serialNumber" value="SN-100" entity="serialNumber" />);

    await userEvent.click(screen.getByText('Load earlier'));

    expect(mockFetchTimelineByFacet).toHaveBeenCalledWith({
      facet: { key: 'serialNumber', value: 'SN-100' },
      query: { entity: 'serialNumber' },
      order: 'desc',
      before: iso(1_000_000), // stationB — the oldest loaded startedAt
      limit: 100,
    });

    // Prepended and chronological: A before B before C.
    await waitFor(() => expect(screen.getByText('stationA')).toBeInTheDocument());
    const text = document.body.textContent ?? '';
    expect(text.indexOf('stationA')).toBeLessThan(text.indexOf('stationB'));
    expect(text.indexOf('stationB')).toBeLessThan(text.indexOf('stationC'));
    expect(screen.getByText('3 intervals')).toBeInTheDocument();

    // The earlier page reported no further overflow — the pager retires.
    expect(screen.queryByText('Load earlier')).not.toBeInTheDocument();
  });

  it('keeps Load earlier while earlier pages still overflow', async () => {
    setHead(HEAD_DESC, true);
    mockFetchTimelineByFacet.mockResolvedValue({ intervals: EARLIER_DESC, overflow: true });
    render(<EntityTimelinePanel facetKey="serialNumber" value="SN-100" entity="serialNumber" />);

    await userEvent.click(screen.getByText('Load earlier'));
    await waitFor(() => expect(screen.getByText('stationA')).toBeInTheDocument());
    expect(screen.getByText('Load earlier')).toBeInTheDocument();
  });

  it('copies the entity deep link to the clipboard with a transient note', async () => {
    setHead(HEAD_DESC, false);
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });

    render(<EntityTimelinePanel facetKey="serialNumber" value="SN-100" entity="serialNumber" />);
    await userEvent.click(screen.getByTitle('Copy link to this timeline'));

    expect(writeText).toHaveBeenCalledWith(
      `${window.location.origin}/operations?lens=serialNumber&entity=SN-100`,
    );
    await waitFor(() => expect(screen.getByText('copied')).toBeInTheDocument());
  });

  it('renders the copy link only when the panel has the entity scope', () => {
    setHead(HEAD_DESC, false);
    render(<EntityTimelinePanel facetKey="serialNumber" value="SN-100" role="print-station" />);
    expect(screen.queryByTitle('Copy link to this timeline')).not.toBeInTheDocument();
  });
});
