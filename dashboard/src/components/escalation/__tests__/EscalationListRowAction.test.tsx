import { render as rtlRender, screen, fireEvent, waitFor, type RenderOptions } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// Metadata-bound columns render router Links — every render gets a router.
const render = (ui: React.ReactElement, options?: RenderOptions) =>
  rtlRender(ui, { wrapper: MemoryRouter, ...options });
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EscalationListView } from '../EscalationListView';
import type { LTEscalationRecord } from '../../../api/types';

const mockMutate = vi.fn();

vi.mock('../../../api/escalations', () => ({
  useEscalations: () => ({ data: undefined, isLoading: false }),
  useClaimEscalation: () => ({ mutate: mockMutate, isPending: false }),
}));

function makeRow(overrides: Partial<LTEscalationRecord> = {}): LTEscalationRecord {
  return {
    id: 'e1',
    type: 'policy-review',
    subtype: 'revision',
    description: 'Update the policy',
    status: 'pending',
    priority: 2,
    task_id: null, origin_id: null, parent_id: null, workflow_id: 'wf1', task_queue: null,
    workflow_type: 'policyDocument', role: 'policy-document',
    assigned_to: null, assigned_until: null, resolved_at: null, claimed_at: null,
    envelope: null,
    metadata: { title: 'Refund Policy' },
    escalation_payload: null,
    resolver_payload: null,
    created_at: '2026-07-14T00:00:00.000Z',
    updated_at: '2026-07-14T00:00:00.000Z',
    trace_id: null, span_id: null,
    ...overrides,
  } as LTEscalationRecord;
}

const TABLE_SCHEMA = {
  'x-lt-layout': 'facet-table',
  'x-lt-columns': [{ label: 'Title', value: '{{metadata.title}}' }],
};

describe('x-lt-row-action', () => {
  beforeEach(() => {
    mockMutate.mockReset();
  });

  it('facet-table rows default to a persistent Claim button (30 min) that claims then opens', async () => {
    const onRowClick = vi.fn();
    render(
      <EscalationListView
        role="policy-document"
        listSchema={TABLE_SCHEMA}
        activeEscalations={[makeRow()]}
        onRowClick={onRowClick}
      />,
    );
    const button = screen.getByTestId('row-action-button');
    expect(button).toHaveTextContent('Claim');
    fireEvent.click(button);
    expect(mockMutate).toHaveBeenCalledWith(
      { id: 'e1', durationMinutes: 30 },
      expect.anything(),
    );
    // claim-then-navigate: success opens the detail page
    mockMutate.mock.calls[0][1].onSuccess();
    await waitFor(() => expect(onRowClick).toHaveBeenCalled());
  });

  it('the template sets label and claim duration', () => {
    render(
      <EscalationListView
        role="policy-document"
        listSchema={{ ...TABLE_SCHEMA, 'x-lt-row-action': { label: 'Take it', durationMinutes: 60 } }}
        activeEscalations={[makeRow()]}
      />,
    );
    const button = screen.getByTestId('row-action-button');
    expect(button).toHaveTextContent('Take it');
    fireEvent.click(button);
    expect(mockMutate).toHaveBeenCalledWith(
      { id: 'e1', durationMinutes: 60 },
      expect.anything(),
    );
  });

  it('action "view" navigates without claiming', () => {
    const onRowClick = vi.fn();
    render(
      <EscalationListView
        role="policy-document"
        listSchema={{ ...TABLE_SCHEMA, 'x-lt-row-action': { action: 'view', label: 'Open' } }}
        activeEscalations={[makeRow()]}
        onRowClick={onRowClick}
      />,
    );
    const button = screen.getByTestId('row-action-button');
    expect(button).toHaveTextContent('Open');
    fireEvent.click(button);
    expect(onRowClick).toHaveBeenCalled();
    expect(mockMutate).not.toHaveBeenCalled();
  });

  it('claim button is absent on rows under a live claim window', () => {
    const claimed = makeRow({
      assigned_to: 'someone',
      assigned_until: new Date(Date.now() + 60_000).toISOString(),
    });
    render(
      <EscalationListView
        role="policy-document"
        listSchema={TABLE_SCHEMA}
        activeEscalations={[claimed]}
      />,
    );
    expect(screen.queryByTestId('row-action-button')).not.toBeInTheDocument();
  });

  it('a rejected claim surfaces its message inline', async () => {
    render(
      <EscalationListView
        role="policy-document"
        listSchema={TABLE_SCHEMA}
        activeEscalations={[makeRow()]}
      />,
    );
    fireEvent.click(screen.getByTestId('row-action-button'));
    mockMutate.mock.calls[0][1].onError(new Error('Escalation not available for claim'));
    const error = await screen.findByTestId('row-action-error');
    expect(error).toHaveTextContent('Escalation not available for claim');
  });

  it('the active-card CTA claims (not just navigates) and honors the token', () => {
    const onRowClick = vi.fn();
    render(
      <EscalationListView
        role="policy-document"
        listSchema={{
          'x-lt-layout': 'active',
          'x-lt-active': { title: '{{metadata.title}}' },
          'x-lt-row-action': { durationMinutes: 45 },
        }}
        activeEscalations={[makeRow()]}
        onRowClick={onRowClick}
      />,
    );
    fireEvent.click(screen.getByTestId('row-action-button'));
    expect(mockMutate).toHaveBeenCalledWith(
      { id: 'e1', durationMinutes: 45 },
      expect.anything(),
    );
    expect(onRowClick).not.toHaveBeenCalled(); // navigation only on success
  });

  it('facet-board cards carry the action on the group latest row', () => {
    render(
      <EscalationListView
        role="fleet-servicer"
        listSchema={{
          'x-lt-layout': 'facet-board',
          'x-lt-group-by': 'metadata.machine',
          'x-lt-card': { title: '{{metadata.machine}}' },
          'x-lt-row-action': { label: 'Service', durationMinutes: 90 },
        }}
        activeEscalations={[makeRow({ metadata: { machine: 'M-1' } })]}
      />,
    );
    const button = screen.getByTestId('row-action-button');
    expect(button).toHaveTextContent('Service');
    fireEvent.click(button);
    expect(mockMutate).toHaveBeenCalledWith(
      { id: 'e1', durationMinutes: 90 },
      expect.anything(),
    );
  });
});
