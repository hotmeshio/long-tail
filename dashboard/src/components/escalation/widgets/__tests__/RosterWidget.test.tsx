import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RosterWidget } from '../RosterWidget';
import { EmbedWriteContext } from '../embed-write';

const mockFetch = vi.fn();
const mockMutateAsync = vi.fn();

vi.mock('../../../../api/escalations', () => ({
  escalationListQuery: (filters: unknown) => ({ queryKey: ['escalations', filters], queryFn: () => mockFetch(filters) }),
  useRosterAction: () => ({ mutateAsync: mockMutateAsync }),
  ROSTER_ACTION_OUTCOMES: { NEEDS_BADGE: 'needs_badge', ROLE_REFUSED: 'role_refused' },
}));

const member = (orderId: string, resolver: unknown = null) => ({
  id: `m-${orderId}`, status: resolver ? 'resolved' : 'pending', role: 'packing',
  metadata: { orderId, po: `PO-${orderId}` }, resolver_payload: resolver ? JSON.stringify(resolver) : null,
});

const SCHEMA = {
  type: 'string',
  title: 'Orders in this box',
  'x-lt-widget': 'roster',
  'x-lt-roster': {
    expected: { query: { role: 'packing', facets: { box: '{{escalation.id}}' } } },
    key: '{{metadata.orderId}}',
    in: ['items', 'resolver.bags'],
    flagged: [{ when: 'resolver.outcome=missing', label: 'Missing' }],
  },
  'x-lt-columns': [
    { label: 'Order', value: '{{metadata.orderId}}' },
    { label: 'PO', value: '{{metadata.po}}' },
  ],
  'x-lt-actions': [
    { label: 'Missing', when: 'waiting', resolverPayload: { outcome: 'missing', order: '{{metadata.orderId}}' }, confirm: 'Mark {{metadata.orderId}} missing?' },
  ],
};

function renderWidget(resolver: Record<string, unknown> = {}, schema: Record<string, unknown> = SCHEMA) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const ctx = { escalation: { id: 'box-1' }, metadata: { accumulate_keys: ['o-1'] }, envelope: null, resolver };
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <RosterWidget fieldKey="orders" value="" onChange={vi.fn()} schema={schema} escalationContext={ctx} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mockFetch.mockReset();
  mockMutateAsync.mockReset();
  mockFetch.mockResolvedValue({ escalations: [member('o-1'), member('o-2'), member('o-3', { outcome: 'missing' })], total: 3 });
});

describe('RosterWidget', () => {
  it('lists every expected member with its state and the headline count', async () => {
    renderWidget();
    expect(await screen.findByTestId('roster-headline-orders')).toHaveTextContent('1 of 3 in · 1 Missing');
    expect(screen.getByTestId('roster-entry-o-1')).toHaveAttribute('data-state', 'in');
    expect(screen.getByTestId('roster-entry-o-2')).toHaveAttribute('data-state', 'waiting');
    expect(screen.getByTestId('roster-state-o-3')).toHaveTextContent('Missing');
    expect(screen.getByTestId('roster-entry-o-2')).toHaveTextContent('PO-o-2');
  });

  it('reads every status of the member role with the facets interpolated', async () => {
    renderWidget();
    await screen.findByTestId('roster-list-orders');
    expect(mockFetch.mock.calls[0][0]).toMatchObject({ roles: ['packing'], facets: { box: 'box-1' }, limit: 200, status: undefined });
  });

  it('ticks an entry in from the live form value', async () => {
    renderWidget({ bags: ['o-2'] });
    await waitFor(() => expect(screen.getByTestId('roster-entry-o-2')).toHaveAttribute('data-state', 'in'));
  });

  it('offers an action only in the states it names', async () => {
    renderWidget();
    await screen.findByTestId('roster-list-orders');
    expect(screen.getByTestId('roster-action-o-2')).toHaveTextContent('Missing');
    expect(screen.queryByTestId('roster-action-o-1')).toBeNull();
    expect(screen.queryByTestId('roster-action-o-3')).toBeNull();
  });

  it('confirms in place, then runs the action on the server by pointer', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm');
    mockMutateAsync.mockResolvedValue({});
    renderWidget();
    fireEvent.click(await screen.findByTestId('roster-action-o-2'));
    expect(screen.getByTestId('roster-confirm-o-2')).toHaveTextContent('Mark o-2 missing?');
    fireEvent.click(screen.getByTestId('roster-confirm-o-2-yes'));
    await waitFor(() => expect(mockMutateAsync).toHaveBeenCalledWith({
      id: 'box-1', field: 'orders', action: 0, entry: 'o-2', code: undefined,
    }));
    expect(confirmSpy).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it('holds an action for the page’s write gate, then runs it when the gate does', async () => {
    mockMutateAsync.mockResolvedValue({});
    let held: (() => Promise<void>) | null = null;
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const ctx = { escalation: { id: 'box-1' }, metadata: { accumulate_keys: ['o-1'] }, envelope: null, resolver: {} };
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <EmbedWriteContext.Provider value={(_verb, run) => { held = run; }}>
            <RosterWidget
              fieldKey="orders" value="" onChange={vi.fn()} escalationContext={ctx}
              schema={{ ...SCHEMA, 'x-lt-actions': [{ label: 'Missing', resolverPayload: { outcome: 'missing' } }] }}
            />
          </EmbedWriteContext.Provider>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    fireEvent.click(await screen.findByTestId('roster-action-o-2'));
    expect(mockMutateAsync).not.toHaveBeenCalled();
    await held!();
    expect(mockMutateAsync).toHaveBeenCalledWith({ id: 'box-1', field: 'orders', action: 0, entry: 'o-2', code: undefined });
  });

  it('shows a refused action on its entry', async () => {
    mockMutateAsync.mockRejectedValue(new Error('Not permitted for role packing'));
    renderWidget({}, { ...SCHEMA, 'x-lt-actions': [{ label: 'Missing', resolverPayload: { outcome: 'missing' } }] });
    fireEvent.click(await screen.findByTestId('roster-action-o-2'));
    expect(await screen.findByTestId('roster-error-o-2')).toHaveTextContent('Not permitted for role packing');
  });

  it('reads a batch roster with labels and no member query', async () => {
    const schema = {
      'x-lt-roster': { expected: { batch: true, labels: 'envelope.labels' } },
      'x-lt-columns': [{ label: 'Box', value: '{{item.label.model}} {{item.label.size}}' }],
    };
    const client = new QueryClient();
    const ctx = {
      metadata: { batch_keys: ['k1', 'k2'], batch_pending: ['k2'] },
      envelope: { labels: { k1: { model: 'Trail', size: '9' }, k2: { model: 'Road', size: '10' } } },
    };
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <RosterWidget fieldKey="boxes" value="" onChange={vi.fn()} schema={schema} escalationContext={ctx} />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(screen.getByTestId('roster-headline-boxes')).toHaveTextContent('1 of 2 in');
    expect(screen.getByTestId('roster-entry-k2')).toHaveTextContent('Road 10');
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
