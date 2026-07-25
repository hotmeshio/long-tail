import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EscalationListView } from '../EscalationListView';
import type { LTEscalationRecord } from '../../../api/types';

const mockMutate = vi.fn();

vi.mock('../../../api/escalations', () => ({
  useEscalations: () => ({ data: undefined, isLoading: false }),
  useClaimEscalation: () => ({ mutate: mockMutate, isPending: false }),
}));

// A row already held by the viewer — the shape every My Escalations row has.
function makeClaimedRow(overrides: Partial<LTEscalationRecord> = {}): LTEscalationRecord {
  return {
    id: 'e1',
    type: 'policy-review',
    subtype: 'revision',
    description: 'Update the policy',
    status: 'pending',
    priority: 2,
    task_id: null, origin_id: null, parent_id: null, workflow_id: 'wf1', task_queue: null,
    workflow_type: 'policyDocument', role: 'policy-document',
    assigned_to: 'viewer-1',
    assigned_until: new Date(Date.now() + 3_600_000).toISOString(),
    resolved_at: null, claimed_at: null,
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

describe('forceViewAction — row actions on already-held rows', () => {
  beforeEach(() => {
    mockMutate.mockReset();
  });

  it('renders a claim template as a View action that opens without claiming', () => {
    const onRowClick = vi.fn();
    render(
      <EscalationListView
        role="policy-document"
        listSchema={TABLE_SCHEMA}
        activeEscalations={[makeClaimedRow()]}
        onRowClick={onRowClick}
        forceViewAction
      />,
    );
    const button = screen.getByTestId('row-action-button');
    expect(button).toHaveTextContent('View');
    fireEvent.click(button);
    expect(onRowClick).toHaveBeenCalled();
    expect(mockMutate).not.toHaveBeenCalled();
  });

  it('drops an authored claim label — claim wording would mislead a held row', () => {
    render(
      <EscalationListView
        role="policy-document"
        listSchema={{ ...TABLE_SCHEMA, 'x-lt-row-action': { label: 'Take it', durationMinutes: 60 } }}
        activeEscalations={[makeClaimedRow()]}
        forceViewAction
      />,
    );
    expect(screen.getByTestId('row-action-button')).toHaveTextContent('View');
  });

  it('keeps an authored view label', () => {
    render(
      <EscalationListView
        role="policy-document"
        listSchema={{ ...TABLE_SCHEMA, 'x-lt-row-action': { action: 'view', label: 'Open item' } }}
        activeEscalations={[makeClaimedRow()]}
        forceViewAction
      />,
    );
    expect(screen.getByTestId('row-action-button')).toHaveTextContent('Open item');
  });

  it('facet-board cards keep their action as View on a held latest row', () => {
    const onRowClick = vi.fn();
    render(
      <EscalationListView
        role="fleet-servicer"
        listSchema={{
          'x-lt-layout': 'facet-board',
          'x-lt-group-by': 'metadata.machine',
          'x-lt-card': { title: '{{metadata.machine}}' },
          'x-lt-row-action': { label: 'Service', durationMinutes: 90 },
        }}
        activeEscalations={[makeClaimedRow({ metadata: { machine: 'M-1' } })]}
        onRowClick={onRowClick}
        forceViewAction
      />,
    );
    const button = screen.getByTestId('row-action-button');
    expect(button).toHaveTextContent('View');
    fireEvent.click(button);
    expect(onRowClick).toHaveBeenCalled();
    expect(mockMutate).not.toHaveBeenCalled();
  });

  it('active-card CTA opens without claiming', () => {
    const onRowClick = vi.fn();
    render(
      <EscalationListView
        role="policy-document"
        listSchema={{
          'x-lt-layout': 'active',
          'x-lt-active': { title: '{{metadata.title}}' },
          'x-lt-row-action': { durationMinutes: 45 },
        }}
        activeEscalations={[makeClaimedRow()]}
        onRowClick={onRowClick}
        forceViewAction
      />,
    );
    fireEvent.click(screen.getByTestId('row-action-button'));
    expect(onRowClick).toHaveBeenCalled();
    expect(mockMutate).not.toHaveBeenCalled();
  });
});
