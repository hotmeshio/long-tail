import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi } from 'vitest';
import { ESCALATION_COLUMNS, TIME_LEFT_COLUMN, EscalationFilterBar, STATUS_OPTIONS } from '../escalation-columns';
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

  // ── Workflow column (the workflow_type name, e.g. richForm) ──
  it('renders the workflow name (workflow_type) as a pill', () => {
    renderColumn('workflow_type', makeEscalation({ type: 'intake', workflow_type: 'richForm' }));
    expect(screen.getByText('richForm')).toBeInTheDocument();
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

  // ── Metadata column (compact preview, expands to JSON) ──
  it('renders a dash when metadata is empty', () => {
    renderColumn('metadata', makeEscalation({ metadata: null }));
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('previews metadata keys and expands to the JSON viewer on click', () => {
    renderColumn('metadata', makeEscalation({ metadata: { confidence: 0.65, flags: 'x', extra: 1 } }));
    expect(screen.getByText('{ confidence, flags +1 }')).toBeInTheDocument();
    fireEvent.click(screen.getByTitle(/expand metadata/i));
    // The interactive JSON viewer renders the values (e.g. the number 0.65),
    // which the collapsed key preview does not.
    expect(screen.getByText('0.65')).toBeInTheDocument();
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
    expect(screen.getByText('Type')).toBeInTheDocument();
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
    // Priority is the third select
    fireEvent.change(selects[2], { target: { value: '1' } });
    expect(setFilter).toHaveBeenCalledWith('priority', '1');
  });
});
