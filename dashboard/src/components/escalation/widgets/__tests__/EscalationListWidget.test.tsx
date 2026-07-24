import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { EscalationListWidget } from '../EscalationListWidget';

const mockUseEscalations = vi.fn();

vi.mock('../../../../api/escalations', () => ({
  useEscalations: (...args: unknown[]) => mockUseEscalations(...args),
}));

vi.mock('../../../../lib/x-lt-help', () => ({
  interpolateHelp: (template: string, ctx: Record<string, unknown>) =>
    template.replace(/\{\{(\w+)\.(\w+)\}\}/g, (_: string, domain: string, key: string) => {
      const d = ctx[domain] as Record<string, string> | undefined;
      return d?.[key] ?? '—';
    }),
}));

vi.mock('../EscalationListView', () => ({
  rowContext: (esc: Record<string, unknown>) => ({
    escalation: esc,
    metadata: esc.metadata ?? {},
    envelope: {},
    payload: {},
    resolver: {},
  }),
}));

function makeEsc(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    type: 'review',
    subtype: 'originator',
    description: `Order review — ${id}`,
    status: 'pending',
    priority: 2,
    role: 'rel-originator',
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    envelope: '{}',
    metadata: { orderId: id, customerId: 'CUST-001' },
    escalation_payload: null,
    resolver_payload: null,
    task_id: null, origin_id: null, parent_id: null,
    workflow_id: null, task_queue: null, workflow_type: null,
    assigned_to: null, assigned_until: null, resolved_at: null,
    claimed_at: null, trace_id: null, span_id: null,
    ...overrides,
  };
}

function renderWidget(
  schema: Record<string, unknown>,
  escalationContext?: Record<string, unknown>,
) {
  return render(
    <MemoryRouter>
      <EscalationListWidget
        fieldKey="sibling_items"
        value=""
        onChange={vi.fn()}
        schema={schema}
        escalationContext={escalationContext}
      />
    </MemoryRouter>,
  );
}

describe('EscalationListWidget', () => {
  beforeEach(() => {
    mockUseEscalations.mockReset();
    mockUseEscalations.mockReturnValue({ data: { escalations: [], total: 0 }, isLoading: false });
  });

  it('renders the field title as the section heading', () => {
    renderWidget({ title: 'Sibling items', 'x-lt-query': { role: 'rel-originator' } });
    expect(screen.getByText('Sibling items')).toBeInTheDocument();
  });

  it('interpolates {{metadata.customerId}} in facet values from escalation context', () => {
    renderWidget(
      {
        title: 'Siblings',
        'x-lt-query': {
          role: 'rel-originator',
          facets: { customerId: '{{metadata.customerId}}' },
          limit: 5,
        },
      },
      { metadata: { customerId: 'CUST-42' } },
    );
    const call = mockUseEscalations.mock.calls[0]?.[0];
    expect(call?.facets?.customerId).toBe('CUST-42');
  });

  it('passes the role from x-lt-query to useEscalations', () => {
    renderWidget({ title: 'List', 'x-lt-query': { role: 'rel-originator', limit: 3 } });
    const call = mockUseEscalations.mock.calls[0]?.[0];
    expect(call?.role).toBe('rel-originator');
    expect(call?.limit).toBe(3);
  });

  it('renders a table row for each escalation with custom columns', () => {
    mockUseEscalations.mockReturnValue({
      data: { escalations: [makeEsc('ORD-001'), makeEsc('ORD-002')], total: 2 },
      isLoading: false,
    });
    renderWidget({
      title: 'List',
      'x-lt-query': { role: 'rel-originator' },
      'x-lt-columns': [{ label: 'Order', value: '{{metadata.orderId}}' }],
    });
    const table = screen.getByTestId('escalation-list-table-sibling_items');
    expect(table).toBeInTheDocument();
    expect(screen.getByText('Order')).toBeInTheDocument();
    expect(screen.getByText('ORD-001')).toBeInTheDocument();
    expect(screen.getByText('ORD-002')).toBeInTheDocument();
  });

  it('falls back to default columns (Description, Role, Age) when x-lt-columns absent', () => {
    mockUseEscalations.mockReturnValue({
      data: { escalations: [makeEsc('ORD-001')], total: 1 },
      isLoading: false,
    });
    renderWidget({ title: 'List', 'x-lt-query': { role: 'rel-originator' } });
    expect(screen.getByText('Description')).toBeInTheDocument();
    expect(screen.getByText('Role')).toBeInTheDocument();
    expect(screen.getByText('Age')).toBeInTheDocument();
  });

  it('shows "No items found" when the list is empty', () => {
    mockUseEscalations.mockReturnValue({
      data: { escalations: [], total: 0 },
      isLoading: false,
    });
    renderWidget({ title: 'List', 'x-lt-query': { role: 'rel-originator' } });
    expect(screen.getByTestId('escalation-list-empty-sibling_items')).toBeInTheDocument();
    expect(screen.getByText('No items found')).toBeInTheDocument();
  });

  it('shows loading skeleton when data is loading', () => {
    mockUseEscalations.mockReturnValue({ data: undefined, isLoading: true });
    const { container } = renderWidget({
      title: 'List',
      'x-lt-query': { role: 'rel-originator' },
    });
    expect(container.querySelector('.animate-pulse')).toBeInTheDocument();
  });

  it('passes status and available from x-lt-query to useEscalations', () => {
    renderWidget({
      title: 'List',
      'x-lt-query': { role: 'rel-originator', status: 'pending', available: true },
    });
    const call = mockUseEscalations.mock.calls[0]?.[0];
    expect(call?.status).toBe('pending');
    expect(call?.available).toBe(true);
  });

  it('renders a detail link for each row', () => {
    mockUseEscalations.mockReturnValue({
      data: { escalations: [makeEsc('ORD-001')], total: 1 },
      isLoading: false,
    });
    renderWidget({ title: 'List', 'x-lt-query': { role: 'rel-originator' } });
    const link = screen.getByTitle('Open escalation detail');
    expect(link).toHaveAttribute('href', '/escalations/detail/ORD-001');
  });
});
