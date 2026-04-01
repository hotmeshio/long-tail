import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi } from 'vitest';
import { ESCALATION_COLUMNS, TIME_LEFT_COLUMN, EscalationFilterBar } from '../escalation-columns';
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
  // ── Type column ──
  it('renders type and subtype', () => {
    renderColumn('type', makeEscalation({ type: 'verify-document', subtype: 'id-check' }));
    expect(screen.getByText('verify-document')).toBeInTheDocument();
    expect(screen.getByText('id-check')).toBeInTheDocument();
  });

  // ── Task column ──
  it('renders dash when no task_id', () => {
    renderColumn('task_id', makeEscalation({ task_id: null }));
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('renders truncated task_id as link', () => {
    renderColumn('task_id', makeEscalation({ task_id: 'abcdef12-3456-7890-abcd-ef1234567890' }));
    const link = screen.getByText('abcdef12…');
    expect(link).toBeInTheDocument();
    expect(link.closest('a')).toHaveAttribute('href', '/workflows/tasks/detail/abcdef12-3456-7890-abcd-ef1234567890');
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

  // ── Workflow column ──
  it('renders workflow type', () => {
    renderColumn('workflow_type', makeEscalation({ workflow_type: 'review-content' }));
    expect(screen.getByText('review-content')).toBeInTheDocument();
  });

  it('renders dash when no workflow_type', () => {
    renderColumn('workflow_type', makeEscalation({ workflow_type: null as any }));
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  // ── Created column ──
  it('renders created_at as TimeAgo', () => {
    renderColumn('created_at', makeEscalation());
    // TimeAgo renders something like "just now" or "0s ago"
    expect(screen.getByText(/ago|now/i)).toBeInTheDocument();
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
    // CountdownTimer renders e.g. "4m 59s"
    expect(screen.getByText(/\d+m\s+\d+s/)).toBeInTheDocument();
  });
});

describe('EscalationFilterBar', () => {
  it('renders role, type, and priority filters', () => {
    render(
      <EscalationFilterBar
        filters={{ role: '', type: '', priority: '' }}
        setFilter={vi.fn()}
        roles={['reviewer', 'engineer']}
        types={['review-content', 'verify-document']}
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
