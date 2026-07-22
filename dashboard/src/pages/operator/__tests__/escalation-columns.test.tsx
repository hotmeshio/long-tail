import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi } from 'vitest';
import { ESCALATION_COLUMNS, TIME_LEFT_COLUMN, EscalationFilterBar, STATUS_OPTIONS, MetadataCell } from '../escalation-columns';
import type { LTEscalationRecord } from '../../../api/types';

function makeEscalation(overrides: Partial<LTEscalationRecord> = {}): LTEscalationRecord {
  return {
    id: 'esc-1',
    type: 'review-content',
    subtype: 'review-content',
    description: 'Test escalation',
    priority: 2,
    status: 'pending',
    task_id: null,
    origin_id: null,
    parent_id: null,
    workflow_id: 'wf-1',
    workflow_type: 'review-content',
    task_queue: 'default',
    role: 'reviewer',
    assigned_to: null,
    assigned_until: null,
    claimed_at: null,
    resolved_at: null,
    envelope: '{}',
    escalation_payload: null,
    resolver_payload: null,
    metadata: null,
    trace_id: null,
    span_id: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

/** Helper to render a column cell */
function renderColumn(colKey: string, row: LTEscalationRecord) {
  const col = ESCALATION_COLUMNS.find((c) => c.key === colKey);
  if (!col) throw new Error(`Column ${colKey} not found`);
  return render(<MemoryRouter>{col.render(row, 0)}</MemoryRouter>);
}

describe('ESCALATION_COLUMNS', () => {
  // ── Summary column (status dot + description only, one line) ──
  it('renders the description as the summary, without an inline pill', () => {
    renderColumn('description', makeEscalation({ type: 'review-content', subtype: 'quality-check', description: 'Content needs review' }));
    expect(screen.getByText('Content needs review')).toBeInTheDocument();
    // The workflow/type now live in their own columns, not inside the summary cell.
    expect(screen.queryByText('quality-check')).not.toBeInTheDocument();
  });

  // ── The column budget: identity, owner, urgency, age — nothing else ──
  it('holds the manufacturing-floor column budget (no workflow/metadata/timestamp columns)', () => {
    expect(ESCALATION_COLUMNS.map((c) => c.key)).toEqual(['description', 'role', 'priority', 'created_at']);
  });

  // ── Role column ──
  it('renders role pill', () => {
    renderColumn('role', makeEscalation({ role: 'engineer' }));
    expect(screen.getByText('engineer')).toBeInTheDocument();
  });

  // ── Priority column ──
  it('renders priority badge', () => {
    renderColumn('priority', makeEscalation({ priority: 1 }));
    expect(screen.getByText('P1')).toBeInTheDocument();
  });

  // ── Ago column (compact relative time) ──
  it('renders created_at as a compact "ago" value', () => {
    renderColumn('created_at', makeEscalation());
    // formatAgoCompact → "now", "0s", "5m", "3h", "2d" …
    expect(screen.getByText(/^(now|\d+(s|m|h|d|w|mo|y))$/)).toBeInTheDocument();
  });

  // ── MetadataCell (the standalone key/value primitive) ──
  it('renders a dash when metadata is empty', () => {
    render(<MemoryRouter><MetadataCell metadata={null} role="reviewer" /></MemoryRouter>);
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('shows first key/value with inline +N indicator, expands on click', () => {
    render(<MemoryRouter><MetadataCell metadata={{ confidence: 0.65, flags: 'x', extra: 1 }} role="reviewer" /></MemoryRouter>);
    // First entry always shown
    expect(screen.getByText('confidence')).toBeInTheDocument();
    expect(screen.getByText('0.65')).toBeInTheDocument();
    // Remaining 2 entries hidden; inline +2 expand button visible
    expect(screen.queryByText('flags')).not.toBeInTheDocument();
    const expandBtn = screen.getByTitle(/show 2 more fields/i);
    fireEvent.click(expandBtn);
    // After expanding all entries visible
    expect(screen.getByText('flags')).toBeInTheDocument();
    expect(screen.getByText('x')).toBeInTheDocument();
  });
});

describe('TIME_LEFT_COLUMN', () => {
  it('renders dash when no assigned_until', () => {
    render(<MemoryRouter>{TIME_LEFT_COLUMN.render(makeEscalation(), 0)}</MemoryRouter>);
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('renders countdown when assigned_until is set', () => {
    const future = new Date(Date.now() + 300_000).toISOString();
    render(<MemoryRouter>{TIME_LEFT_COLUMN.render(makeEscalation({ assigned_until: future }), 0)}</MemoryRouter>);
    // CountdownTimer renders e.g. "4m 59s" or "5m"
    expect(screen.getByText(/\d+m(\s+\d+s)?/)).toBeInTheDocument();
  });
});

describe('STATUS_OPTIONS', () => {
  it('includes cancelled option', () => {
    const values = STATUS_OPTIONS.map((o) => o.value);
    expect(values).toContain('cancelled');
  });

  it('includes every terminal and live status value', () => {
    const values = STATUS_OPTIONS.map((o) => o.value);
    expect(values).toEqual(expect.arrayContaining(['available', 'claimed', 'resolved', 'cancelled', 'expired']));
  });

  it('renders cancelled status option in filter bar when showStatus is true', () => {
    render(
      <EscalationFilterBar
        filters={{ role: '', type: '', priority: '', status: '' }}
        setFilter={vi.fn()}
        roles={[]}
        types={[]}
        showStatus
      />,
    );
    expect(screen.getByText('Cancelled')).toBeInTheDocument();
  });
});

describe('EscalationFilterBar', () => {
  it('renders role, type, and priority filters', () => {
    render(
      <EscalationFilterBar
        filters={{ role: '', type: '', priority: '' }}
        setFilter={vi.fn()}
        roles={['reviewer', 'engineer']}
        types={['review-content', 'kitchen-sink']}
      />,
    );
    expect(screen.getByText('Role')).toBeInTheDocument();
    expect(screen.getByText('Workflow Type')).toBeInTheDocument();
    expect(screen.getByText('Priority')).toBeInTheDocument();
  });

  it('calls setFilter on role change', () => {
    const setFilter = vi.fn();
    render(
      <EscalationFilterBar
        filters={{ role: '', type: '', priority: '' }}
        setFilter={setFilter}
        roles={['reviewer']}
        types={[]}
      />,
    );
    const selects = screen.getAllByRole('combobox');
    fireEvent.change(selects[0], { target: { value: 'reviewer' } });
    expect(setFilter).toHaveBeenCalledWith('role', 'reviewer');
  });

  it('calls setFilter on priority change', () => {
    const setFilter = vi.fn();
    render(
      <EscalationFilterBar
        filters={{ role: '', type: '', priority: '' }}
        setFilter={setFilter}
        roles={[]}
        types={[]}
      />,
    );
    const selects = screen.getAllByRole('combobox');
    // Order (no status shown): Role, Priority, Workflow Type
    fireEvent.change(selects[1], { target: { value: '1' } });
    expect(setFilter).toHaveBeenCalledWith('priority', '1');
  });
});

describe('MetadataCell — native-type facet URLs', () => {
  function renderCell(metadata: Record<string, unknown>, role = 'crew-worker') {
    render(
      <MemoryRouter>
        <MetadataCell metadata={metadata} role={role} />
      </MemoryRouter>,
    );
  }

  function filterHref(title: RegExp): string {
    return screen.getByTitle(title).getAttribute('href') ?? '';
  }

  it('encodes boolean true as JSON true (not string "true") in the role-filter link', () => {
    renderCell({ crew_pill: true });
    const href = filterHref(/Filter crew-worker: crew_pill = true/);
    const facets = JSON.parse(decodeURIComponent(new URLSearchParams(href.split('?')[1]).get('facets')!));
    expect(facets.crew_pill).toBe(true);
    expect(typeof facets.crew_pill).toBe('boolean');
  });

  it('encodes boolean false as JSON false in the role-filter link', () => {
    renderCell({ active: false });
    const href = filterHref(/Filter crew-worker: active = false/);
    const facets = JSON.parse(decodeURIComponent(new URLSearchParams(href.split('?')[1]).get('facets')!));
    expect(facets.active).toBe(false);
    expect(typeof facets.active).toBe('boolean');
  });

  it('encodes number as JSON number (not string) in the role-filter link', () => {
    renderCell({ confidence: 0.95 }, 'reviewer');
    const href = filterHref(/Filter reviewer: confidence = 0.95/);
    const facets = JSON.parse(decodeURIComponent(new URLSearchParams(href.split('?')[1]).get('facets')!));
    expect(facets.confidence).toBe(0.95);
    expect(typeof facets.confidence).toBe('number');
  });

  it('encodes integer schema_version as JSON number (the original bug)', () => {
    renderCell({ schema_version: 1 }, 'checklist-operator');
    const href = filterHref(/Filter checklist-operator: schema_version = 1/);
    const facets = JSON.parse(decodeURIComponent(new URLSearchParams(href.split('?')[1]).get('facets')!));
    expect(facets.schema_version).toBe(1);
    expect(typeof facets.schema_version).toBe('number');
  });

  it('encodes string as JSON string in the role-filter link', () => {
    renderCell({ status: 'active' });
    const href = filterHref(/Filter crew-worker: status = active/);
    const facets = JSON.parse(decodeURIComponent(new URLSearchParams(href.split('?')[1]).get('facets')!));
    expect(facets.status).toBe('active');
    expect(typeof facets.status).toBe('string');
  });

  it('global search link omits role param and preserves native type', () => {
    renderCell({ crew_pill: true });
    const href = filterHref(/Search all: crew_pill = true/);
    expect(href).not.toContain('role=');
    const facets = JSON.parse(decodeURIComponent(new URLSearchParams(href.split('?')[1]).get('facets')!));
    expect(facets.crew_pill).toBe(true);
  });
});
