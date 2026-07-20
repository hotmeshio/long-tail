import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { createElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { EscalationListView, rowContext } from '../EscalationListView';
import type { LTEscalationRecord } from '../../../api/types';

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: qc }, children);
}

const ROW: LTEscalationRecord = {
  id: 'e1',
  type: 'policy-review',
  subtype: 'revision',
  description: 'Update the policy',
  status: 'pending',
  priority: 2,
  task_id: null, origin_id: null, parent_id: null, workflow_id: 'wf1', task_queue: null,
  workflow_type: 'policyDocument', role: 'policy-document',
  assigned_to: 'alice', assigned_until: null, resolved_at: null, claimed_at: null,
  envelope: JSON.stringify({ source: 'seed' }),
  metadata: { title: 'Refund Policy', owner: 'Legal' },
  escalation_payload: JSON.stringify({ document_markdown: '## Refunds\n\nWithin **30 days**.' }),
  resolver_payload: null,
  created_at: '2026-07-14T00:00:00.000Z',
  updated_at: '2026-07-14T00:00:00.000Z',
  trace_id: null, span_id: null,
};

describe('rowContext', () => {
  it('parses the JSON-string envelope/payload fields and keeps metadata as an object', () => {
    const ctx = rowContext(ROW);
    expect((ctx.metadata as any).title).toBe('Refund Policy');
    expect((ctx.payload as any).document_markdown).toContain('Refunds');
    expect((ctx.envelope as any).source).toBe('seed');
    expect(ctx.resolver).toBeNull();
  });

  it('tolerates malformed JSON strings (returns null, never throws)', () => {
    const ctx = rowContext({ ...ROW, escalation_payload: '{not json' });
    expect(ctx.payload).toBeNull();
  });
});

describe('EscalationListView', () => {
  const SCHEMA = {
    'x-lt-layout': 'active-history',
    'x-lt-active': {
      title: '{{metadata.title}}',
      subtitle: 'Owner {{metadata.owner}}',
      body: '{{payload.document_markdown}}',
      fields: [{ label: 'Role', value: '{{escalation.role}}' }],
    },
    'x-lt-history': { row: { title: '{{metadata.title}}' } },
  };

  it('renders the active card with interpolated tokens and markdown body', () => {
    render(<EscalationListView role="policy-document" listSchema={SCHEMA} activeEscalations={[ROW]} />, { wrapper: wrapper() });
    expect(screen.getByText('Refund Policy')).toBeInTheDocument();
    expect(screen.getByText('Owner Legal')).toBeInTheDocument();
    expect(screen.getByText('policy-document')).toBeInTheDocument(); // field value token
    expect(screen.getByRole('heading', { name: 'Refunds' })).toBeInTheDocument(); // markdown h2
  });

  it('shows a Load full history affordance that is not auto-loaded', () => {
    render(<EscalationListView role="policy-document" listSchema={SCHEMA} activeEscalations={[ROW]} />, { wrapper: wrapper() });
    expect(screen.getByTestId('load-history')).toBeInTheDocument();
    // History rows only appear after the button is clicked — nothing loaded yet.
    expect(screen.queryByText(/No past revisions|Loading history/)).not.toBeInTheDocument();
  });

  it('renders an empty-state card when there is no active item', () => {
    render(<EscalationListView role="policy-document" listSchema={SCHEMA} activeEscalations={[]} />, { wrapper: wrapper() });
    expect(screen.getByText(/No active item/)).toBeInTheDocument();
  });

  it('active layout renders only the card (no history column)', () => {
    render(
      <EscalationListView role="policy-document" listSchema={{ ...SCHEMA, 'x-lt-layout': 'active' }} activeEscalations={[ROW]} />,
      { wrapper: wrapper() },
    );
    expect(screen.getByText('Refund Policy')).toBeInTheDocument();
    expect(screen.queryByTestId('load-history')).not.toBeInTheDocument();
  });

  it('shows a Claim button for an open item that navigates to detail', () => {
    const onClick = vi.fn();
    render(<EscalationListView role="policy-document" listSchema={SCHEMA} activeEscalations={[ROW]} onRowClick={onClick} />, { wrapper: wrapper() });
    screen.getByRole('button', { name: /Claim/ }).click();
    expect(onClick).toHaveBeenCalledWith(ROW);
  });

  it('hides Claim when the item is already effectively claimed', () => {
    const claimed = { ...ROW, assigned_to: 'bob', assigned_until: '2099-01-01T00:00:00.000Z' };
    render(<EscalationListView role="policy-document" listSchema={SCHEMA} activeEscalations={[claimed]} />, { wrapper: wrapper() });
    expect(screen.queryByRole('button', { name: /Claim/ })).not.toBeInTheDocument();
  });

  it('falls back to the row type when no title template is given', () => {
    const onClick = vi.fn();
    render(
      <EscalationListView role="policy-document" listSchema={{ 'x-lt-layout': 'active', 'x-lt-active': {} }} activeEscalations={[ROW]} onRowClick={onClick} />,
      { wrapper: wrapper() },
    );
    expect(screen.getByText('policy-review')).toBeInTheDocument();
  });
});

describe('EscalationListView — facet-table layout', () => {
  const TABLE_SCHEMA = {
    'x-lt-layout': 'facet-table' as const,
    'x-lt-columns': [
      { label: 'Title', value: '{{metadata.title}}' },
      { label: 'Owner', value: '{{metadata.owner}}' },
    ],
  };

  const ROW2: LTEscalationRecord = {
    ...ROW,
    id: 'e2',
    metadata: { title: 'Terms of Service', owner: 'Finance' },
  };

  it('renders column headers from x-lt-columns', () => {
    render(
      <EscalationListView role="policy-document" listSchema={TABLE_SCHEMA} activeEscalations={[ROW]} />,
      { wrapper: wrapper() },
    );
    expect(screen.getByText('Title')).toBeInTheDocument();
    expect(screen.getByText('Owner')).toBeInTheDocument();
  });

  it('renders one row per escalation with interpolated values', () => {
    render(
      <EscalationListView role="policy-document" listSchema={TABLE_SCHEMA} activeEscalations={[ROW, ROW2]} />,
      { wrapper: wrapper() },
    );
    expect(screen.getByText('Refund Policy')).toBeInTheDocument();
    expect(screen.getByText('Legal')).toBeInTheDocument();
    expect(screen.getByText('Terms of Service')).toBeInTheDocument();
    expect(screen.getByText('Finance')).toBeInTheDocument();
  });

  it('renders all rows via data-testid', () => {
    render(
      <EscalationListView role="policy-document" listSchema={TABLE_SCHEMA} activeEscalations={[ROW, ROW2]} />,
      { wrapper: wrapper() },
    );
    expect(screen.getAllByTestId('facet-table-row')).toHaveLength(2);
  });

  it('calls onRowClick when a row is clicked', () => {
    const onClick = vi.fn();
    render(
      <EscalationListView role="policy-document" listSchema={TABLE_SCHEMA} activeEscalations={[ROW, ROW2]} onRowClick={onClick} />,
      { wrapper: wrapper() },
    );
    screen.getAllByTestId('facet-table-row')[1].click();
    expect(onClick).toHaveBeenCalledWith(ROW2);
  });

  it('shows empty-state when no rows', () => {
    render(
      <EscalationListView role="policy-document" listSchema={TABLE_SCHEMA} activeEscalations={[]} />,
      { wrapper: wrapper() },
    );
    expect(screen.getByText(/No pending items/)).toBeInTheDocument();
  });

  it('renders em dash for unresolvable token values', () => {
    render(
      <EscalationListView
        role="policy-document"
        listSchema={{ 'x-lt-layout': 'facet-table', 'x-lt-columns': [{ label: 'Missing', value: '{{metadata.nope}}' }] }}
        activeEscalations={[ROW]}
      />,
      { wrapper: wrapper() },
    );
    expect(screen.getByText('—')).toBeInTheDocument();
  });
});

// ── facet-board ──────────────────────────────────────────────────────────────

describe('EscalationListView — facet-board', () => {
  const BOARD_SCHEMA = {
    'x-lt-layout': 'facet-board',
    'x-lt-group-by': 'metadata.fleetMachine',
    'x-lt-card': {
      title: '{{metadata.fleetMachine}}',
      state: '{{escalation.subtype}}',
      fields: [
        { label: 'PO', value: '{{metadata.po}}' },
        { label: 'Since', value: '{{escalation.created_at}}', format: 'age' },
      ],
    },
  };

  const machineRow = (over: Partial<LTEscalationRecord>): LTEscalationRecord => ({
    ...ROW,
    metadata: { fleetMachine: 'M-01', po: 'PO-9' },
    ...over,
  });

  it('groups rows by the facet and renders one card per machine (mixed subtypes)', () => {
    const rows = [
      machineRow({ id: 'a1', subtype: 'printing', metadata: { fleetMachine: 'M-01', po: 'PO-9' } }),
      machineRow({ id: 'b1', subtype: 'idle', metadata: { fleetMachine: 'M-02', po: 'PO-4' } }),
      machineRow({ id: 'b2', subtype: 'finished', metadata: { fleetMachine: 'M-02', po: 'PO-5' }, created_at: '2026-07-15T00:00:00.000Z' }),
    ];
    render(
      <EscalationListView role="fleet" listSchema={BOARD_SCHEMA} activeEscalations={rows} />,
      { wrapper: wrapper() },
    );
    const cards = screen.getAllByTestId('facet-board-card');
    expect(cards).toHaveLength(2);
    expect(screen.getByText('M-01')).toBeInTheDocument();
    expect(screen.getByText('M-02')).toBeInTheDocument();
  });

  it('each card renders from the group latest row by created_at', () => {
    const rows = [
      machineRow({ id: 'b1', subtype: 'idle', metadata: { fleetMachine: 'M-02', po: 'PO-4' }, created_at: '2026-07-13T00:00:00.000Z' }),
      machineRow({ id: 'b2', subtype: 'finished', metadata: { fleetMachine: 'M-02', po: 'PO-5' }, created_at: '2026-07-15T00:00:00.000Z' }),
    ];
    render(
      <EscalationListView role="fleet" listSchema={BOARD_SCHEMA} activeEscalations={rows} />,
      { wrapper: wrapper() },
    );
    // Latest row wins: state chip + fields come from b2
    expect(screen.getByText('finished')).toBeInTheDocument();
    expect(screen.queryByText('idle')).not.toBeInTheDocument();
    expect(screen.getByText('PO-5')).toBeInTheDocument();
    expect(screen.getByText('2 rows in scope')).toBeInTheDocument();
  });

  it('rows missing the group-by facet are skipped — the board never invents entities', () => {
    const rows = [
      machineRow({ id: 'a1', metadata: { fleetMachine: 'M-01', po: 'PO-9' } }),
      machineRow({ id: 'x1', metadata: { po: 'PO-0' } }), // no fleetMachine
    ];
    render(
      <EscalationListView role="fleet" listSchema={BOARD_SCHEMA} activeEscalations={rows} />,
      { wrapper: wrapper() },
    );
    expect(screen.getAllByTestId('facet-board-card')).toHaveLength(1);
  });

  it('format:"age" renders a compact age with the absolute time as tooltip', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-07-14T03:00:00.000Z'));
    try {
      render(
        <EscalationListView
          role="fleet"
          listSchema={BOARD_SCHEMA}
          activeEscalations={[machineRow({ id: 'a1', created_at: '2026-07-14T00:00:00.000Z' })]}
        />,
        { wrapper: wrapper() },
      );
      const age = screen.getByText('3h');
      expect(age).toHaveAttribute('title');
    } finally {
      vi.useRealTimers();
    }
  });

  it('card click opens the group history — table view filtered to the facet value', () => {
    const onOpenGroup = vi.fn();
    render(
      <EscalationListView
        role="fleet"
        listSchema={BOARD_SCHEMA}
        activeEscalations={[machineRow({ id: 'a1' })]}
        onOpenGroup={onOpenGroup}
      />,
      { wrapper: wrapper() },
    );
    screen.getByTestId('facet-board-card').click();
    expect(onOpenGroup).toHaveBeenCalledTimes(1);
    const url = onOpenGroup.mock.calls[0][0] as string;
    expect(url).toContain('/escalations/available');
    expect(url).toContain('role=fleet');
    expect(url).toContain('view=table');
    expect(decodeURIComponent(url)).toContain('"fleetMachine":"M-01"');
  });

  it('empty scope renders the quiet no-entities state', () => {
    render(
      <EscalationListView role="fleet" listSchema={BOARD_SCHEMA} activeEscalations={[]} />,
      { wrapper: wrapper() },
    );
    expect(screen.getByText('No entities in scope.')).toBeInTheDocument();
  });
});
