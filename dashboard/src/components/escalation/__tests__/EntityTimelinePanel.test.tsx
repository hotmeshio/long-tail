import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { TimelineInterval } from '../../../api/escalation-analytics';

// ── Mocks — the analytics hook is the panel's only data source ───────────────

const mockUseTimelineByFacet = vi.fn();
vi.mock('../../../api/escalation-analytics', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../api/escalation-analytics')>();
  return {
    ...actual,
    useTimelineByFacet: (...args: unknown[]) => mockUseTimelineByFacet(...args),
    fetchTimelineByFacet: vi.fn(),
    isForbidden: (error: unknown) => (error as { status?: number } | null)?.status === 403,
  };
});

vi.mock('../../../hooks/useEventHooks', () => ({
  useEscalationAnalyticsEvents: vi.fn(),
}));

const mockClosePanel = vi.fn();
vi.mock('../../../hooks/useShellPanel', () => ({
  useShellPanel: () => ({ closePanel: mockClosePanel }),
}));

// The self-serve color hook runs its own analytics queries — out of scope for
// these render tests (no QueryClient); stub it to a no-op resolver.
vi.mock('../../../pages/operations/useEntityStateColors', () => ({
  useEntityStateColors: () => () => undefined,
}));

import { EntityTimelinePanel } from '../EntityTimelinePanel';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const T0 = Date.parse('2026-08-01T10:00:00.000Z');
const iso = (offsetMs: number) => new Date(T0 + offsetMs).toISOString();

function interval(overrides: Partial<TimelineInterval>): TimelineInterval {
  return {
    role: 'print-station',
    subtype: null,
    status: 'resolved',
    facets: {},
    startedAt: iso(0),
    endedAt: iso(600_000),
    durationSeconds: 600,
    ...overrides,
  };
}

/** The head page arrives newest-first (order desc), as the server returns it. */
function setTimeline(intervalsDesc: TimelineInterval[], overflow = false) {
  mockUseTimelineByFacet.mockReturnValue({
    data: { intervals: intervalsDesc, overflow },
    error: null,
    isLoading: false,
  });
}

function renderPanel() {
  return render(
    <EntityTimelinePanel facetKey="serialNumber" value="SN-100" role="print-station" />,
  );
}

describe('EntityTimelinePanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the newest-first page chronologically with the facet header', () => {
    setTimeline([
      // Contiguous handoff (500ms) — no untracked separator between them.
      interval({ role: 'assembly', startedAt: iso(600_500), endedAt: null, durationSeconds: 120 }),
      interval({ role: 'print-station', startedAt: iso(0), endedAt: iso(600_000) }),
    ]);
    renderPanel();

    expect(screen.getByText('serialNumber')).toBeInTheDocument();
    expect(screen.getByText('SN-100')).toBeInTheDocument();
    expect(screen.getByText('2 intervals')).toBeInTheDocument();

    const text = document.body.textContent ?? '';
    expect(text.indexOf('print-station')).toBeGreaterThan(-1);
    expect(text.indexOf('print-station')).toBeLessThan(text.indexOf('assembly'));
    expect(screen.queryByText(/untracked/)).not.toBeInTheDocument();
  });

  it('renders an untracked separator for gaps over one second', () => {
    setTimeline([
      // 90s of untracked time before the next station picks it up.
      interval({ role: 'assembly', startedAt: iso(690_000), endedAt: null, durationSeconds: 60 }),
      interval({ role: 'print-station', startedAt: iso(0), endedAt: iso(600_000) }),
    ]);
    renderPanel();
    expect(screen.getByText(/untracked/)).toBeInTheDocument();
  });

  it('renders the quiet scope notice on a 403', () => {
    mockUseTimelineByFacet.mockReturnValue({
      data: undefined,
      error: { status: 403 },
      isLoading: false,
    });
    renderPanel();
    expect(
      screen.getByText("Timeline requires full read access to this station's queue."),
    ).toBeInTheDocument();
  });

  it('renders an empty-state line when no escalation carried the value', () => {
    setTimeline([]);
    renderPanel();
    expect(screen.getByText('No escalation has carried this value.')).toBeInTheDocument();
  });

  it('requests the newest page desc, scoped to the given role', () => {
    setTimeline([]);
    renderPanel();
    expect(mockUseTimelineByFacet).toHaveBeenCalledWith({
      facet: { key: 'serialNumber', value: 'SN-100' },
      query: { roles: ['print-station'] },
      order: 'desc',
      limit: 100,
    });
  });

  it('scopes the query to the entity system when entity is given', () => {
    setTimeline([]);
    render(<EntityTimelinePanel facetKey="serialNumber" value="SN-100" entity="serialNumber" />);
    expect(mockUseTimelineByFacet).toHaveBeenCalledWith({
      facet: { key: 'serialNumber', value: 'SN-100' },
      query: { entity: 'serialNumber' },
      order: 'desc',
      limit: 100,
    });
  });
});
