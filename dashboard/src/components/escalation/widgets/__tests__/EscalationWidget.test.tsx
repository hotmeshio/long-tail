import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { EscalationWidget } from '../EscalationWidget';

const mockUseEscalation = vi.fn();

vi.mock('../../../../api/escalations', () => ({
  useEscalation: (...args: unknown[]) => mockUseEscalation(...args),
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
    resolver: typeof esc.resolver_payload === 'string'
      ? JSON.parse(esc.resolver_payload)
      : (esc.resolver_payload ?? {}),
  }),
}));

const SAMPLE_ESC = {
  id: 'esc-uuid-001',
  type: 'review',
  subtype: 'originator',
  description: 'Order review — ORD-001',
  status: 'resolved',
  priority: 2,
  role: 'rel-originator',
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T01:00:00Z',
  envelope: '{}',
  metadata: { orderId: 'ORD-001' },
  escalation_payload: null,
  resolver_payload: '{"decision":"Escalate","reason":"Needs review"}',
  task_id: null,
  origin_id: null,
  parent_id: null,
  workflow_id: null,
  task_queue: null,
  workflow_type: null,
  assigned_to: null,
  assigned_until: null,
  resolved_at: null,
  claimed_at: null,
  trace_id: null,
  span_id: null,
};

function renderWidget(
  schema: Record<string, unknown>,
  escalationContext?: Record<string, unknown>,
) {
  return render(
    <MemoryRouter>
      <EscalationWidget
        fieldKey="originator_escalation"
        value=""
        onChange={vi.fn()}
        schema={schema}
        escalationContext={escalationContext}
      />
    </MemoryRouter>,
  );
}

describe('EscalationWidget', () => {
  beforeEach(() => {
    mockUseEscalation.mockReset();
    mockUseEscalation.mockReturnValue({ data: undefined, isLoading: false, isError: false });
  });

  it('shows "No linked record" when x-lt-source is absent', () => {
    renderWidget({ title: 'Parent', 'x-lt-widget': 'escalation' });
    expect(screen.getByTestId('escalation-widget-empty-originator_escalation')).toBeInTheDocument();
  });

  it('shows "No linked record" when source path resolves to an empty value', () => {
    renderWidget(
      { title: 'Parent', 'x-lt-source': 'metadata.parent_escalation_id' },
      { metadata: {} },
    );
    expect(screen.getByTestId('escalation-widget-empty-originator_escalation')).toBeInTheDocument();
    expect(mockUseEscalation).toHaveBeenCalledWith('');
  });

  it('resolves the escalation ID from metadata via x-lt-source', () => {
    mockUseEscalation.mockReturnValue({ data: SAMPLE_ESC, isLoading: false, isError: false });
    renderWidget(
      { title: 'Parent', 'x-lt-source': 'metadata.parent_escalation_id' },
      { metadata: { parent_escalation_id: 'esc-uuid-001' } },
    );
    expect(mockUseEscalation).toHaveBeenCalledWith('esc-uuid-001');
  });

  it('renders the card with type, status, and description when data loads', () => {
    mockUseEscalation.mockReturnValue({ data: SAMPLE_ESC, isLoading: false, isError: false });
    renderWidget(
      { title: 'Originating escalation', 'x-lt-source': 'metadata.parent_escalation_id' },
      { metadata: { parent_escalation_id: 'esc-uuid-001' } },
    );
    expect(screen.getByTestId('escalation-widget-card-originator_escalation')).toBeInTheDocument();
    expect(screen.getByText('Order review — ORD-001')).toBeInTheDocument();
    expect(screen.getByText(/resolved/i)).toBeInTheDocument();
  });

  it('renders x-lt-fields rows resolved against the embedded escalation context', () => {
    mockUseEscalation.mockReturnValue({ data: SAMPLE_ESC, isLoading: false, isError: false });
    renderWidget(
      {
        title: 'Parent esc',
        'x-lt-source': 'metadata.parent_escalation_id',
        'x-lt-fields': [
          { label: 'Decision', value: '{{resolver.decision}}' },
          { label: 'Reason', value: '{{resolver.reason}}' },
        ],
      },
      { metadata: { parent_escalation_id: 'esc-uuid-001' } },
    );
    expect(screen.getByText('Decision')).toBeInTheDocument();
    expect(screen.getByText('Escalate')).toBeInTheDocument();
    expect(screen.getByText('Reason')).toBeInTheDocument();
    expect(screen.getByText('Needs review')).toBeInTheDocument();
  });

  it('shows loading skeleton when data is loading', () => {
    mockUseEscalation.mockReturnValue({ data: undefined, isLoading: true, isError: false });
    const { container } = renderWidget(
      { title: 'Parent', 'x-lt-source': 'metadata.parent_escalation_id' },
      { metadata: { parent_escalation_id: 'esc-uuid-001' } },
    );
    expect(container.querySelector('.animate-pulse')).toBeInTheDocument();
  });

  it('shows "No linked record" on fetch error', () => {
    mockUseEscalation.mockReturnValue({ data: undefined, isLoading: false, isError: true });
    renderWidget(
      { title: 'Parent', 'x-lt-source': 'metadata.parent_escalation_id' },
      { metadata: { parent_escalation_id: 'esc-uuid-001' } },
    );
    expect(screen.getByTestId('escalation-widget-empty-originator_escalation')).toBeInTheDocument();
  });

  it('renders the field title as the section heading', () => {
    renderWidget(
      { title: 'Originating request', 'x-lt-source': 'metadata.parent_escalation_id' },
      { metadata: {} },
    );
    expect(screen.getByText('Originating request')).toBeInTheDocument();
  });

  it('renders the description as helper text', () => {
    renderWidget(
      {
        title: 'Parent',
        description: 'The escalation that created this item',
        'x-lt-source': 'metadata.parent_escalation_id',
      },
      { metadata: {} },
    );
    expect(screen.getByText('The escalation that created this item')).toBeInTheDocument();
  });
});
