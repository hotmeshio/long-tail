import { render as rtlRender, screen, fireEvent, type RenderOptions } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi } from 'vitest';
import { EscalationListView } from '../EscalationListView';
import type { LTEscalationRecord } from '../../../api/types';

vi.mock('../../../api/escalations', () => ({
  useEscalations: () => ({ data: undefined, isLoading: false }),
  useClaimEscalation: () => ({ mutate: vi.fn(), isPending: false }),
}));

const render = (ui: React.ReactElement, options?: RenderOptions) =>
  rtlRender(ui, { wrapper: MemoryRouter, ...options });

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
    metadata: { owner: 'Legal' },
    escalation_payload: null,
    resolver_payload: null,
    created_at: '2026-07-14T00:00:00.000Z',
    updated_at: '2026-07-14T00:00:00.000Z',
    trace_id: null, span_id: null,
    ...overrides,
  } as LTEscalationRecord;
}

const SCHEMA = {
  'x-lt-layout': 'facet-table',
  'x-lt-columns': [
    { label: 'Owner', value: '{{metadata.owner}}' },
    { label: 'Description', value: '{{escalation.description}}' },
  ],
};

describe('facet-table metadata columns — filter/search affordance', () => {
  it('a metadata-bound column carries filter and search links for its value', () => {
    render(
      <EscalationListView role="policy-document" listSchema={SCHEMA} activeEscalations={[makeRow()]} />,
    );
    const filter = screen.getByTestId('facet-column-filter');
    const search = screen.getByTestId('facet-column-search');
    const facets = encodeURIComponent(JSON.stringify({ owner: 'Legal' }));
    expect(filter).toHaveAttribute(
      'href',
      `/escalations/available?role=policy-document&facets=${facets}&status=all`,
    );
    expect(search).toHaveAttribute('href', `/escalations/available?facets=${facets}&status=all`);
  });

  it('non-metadata columns render plain values with no affordance', () => {
    render(
      <EscalationListView
        role="policy-document"
        listSchema={{ ...SCHEMA, 'x-lt-columns': [{ label: 'Description', value: '{{escalation.description}}' }] }}
        activeEscalations={[makeRow()]}
      />,
    );
    expect(screen.queryByTestId('facet-column-filter')).not.toBeInTheDocument();
    expect(screen.queryByTestId('facet-column-search')).not.toBeInTheDocument();
  });

  it('a row without the bound value stays plain', () => {
    render(
      <EscalationListView
        role="policy-document"
        listSchema={SCHEMA}
        activeEscalations={[makeRow({ metadata: {} })]}
      />,
    );
    expect(screen.queryByTestId('facet-column-filter')).not.toBeInTheDocument();
  });

  it('⇧ click on the filter merges the facet into the live filter set', () => {
    const onAddFacet = vi.fn();
    render(
      <EscalationListView
        role="policy-document"
        listSchema={SCHEMA}
        activeEscalations={[makeRow()]}
        onAddFacet={onAddFacet}
      />,
    );
    fireEvent.click(screen.getByTestId('facet-column-filter'), { shiftKey: true });
    expect(onAddFacet).toHaveBeenCalledWith('owner', 'Legal');
  });
});
