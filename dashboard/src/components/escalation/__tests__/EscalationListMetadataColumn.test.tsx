import { render as rtlRender, screen, fireEvent, type RenderOptions } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { describe, it, expect, vi } from 'vitest';
import { EscalationListView } from '../EscalationListView';
import type { LTEscalationRecord } from '../../../api/types';

vi.mock('../../../api/escalations', () => ({
  useEscalations: () => ({ data: undefined, isLoading: false }),
  useClaimEscalation: () => ({ mutate: vi.fn(), isPending: false }),
}));

/** Where the refine actions navigated — asserts the facet deep-link. */
function LocationProbe() {
  const loc = useLocation();
  return <div data-testid="loc">{loc.pathname + decodeURIComponent(loc.search)}</div>;
}

const render = (ui: React.ReactElement, options?: RenderOptions) =>
  rtlRender(<>{ui}<LocationProbe /></>, { wrapper: MemoryRouter, ...options });

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
    metadata: { owner: 'Legal', po: 'PO-9' },
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
    { label: 'PO', value: '{{metadata.po}}' },
    { label: 'Description', value: '{{escalation.description}}' },
  ],
};

describe('facet-table refine — cells carry data, the row carries the drill', () => {
  it('cells render plain values with the full text on hover — no per-cell icons', () => {
    render(
      <EscalationListView role="policy-document" listSchema={SCHEMA} activeEscalations={[makeRow()]} />,
    );
    expect(screen.getByText('Legal')).toHaveAttribute('title', 'Legal');
    expect(screen.queryByTestId('facet-column-filter')).not.toBeInTheDocument();
    expect(screen.queryByTestId('facet-column-search')).not.toBeInTheDocument();
  });

  it('a row with metadata-bound columns carries ONE refine trigger', () => {
    render(
      <EscalationListView role="policy-document" listSchema={SCHEMA} activeEscalations={[makeRow()]} />,
    );
    expect(screen.getAllByTestId('row-refine')).toHaveLength(1);
  });

  it('rows without metadata-bound values carry no trigger', () => {
    render(
      <EscalationListView
        role="policy-document"
        listSchema={{ ...SCHEMA, 'x-lt-columns': [{ label: 'Description', value: '{{escalation.description}}' }] }}
        activeEscalations={[makeRow()]}
      />,
    );
    expect(screen.queryByTestId('row-refine')).not.toBeInTheDocument();
  });

  it('the dialog lists the row facts; multi-select ANDs facets into a role-scoped filter', () => {
    render(
      <EscalationListView role="policy-document" listSchema={SCHEMA} activeEscalations={[makeRow()]} />,
    );
    fireEvent.click(screen.getByTestId('row-refine'));

    const pairs = screen.getAllByTestId('refine-pair');
    expect(pairs).toHaveLength(2); // owner + po — description is not metadata-bound
    fireEvent.click(pairs[0]);
    fireEvent.click(pairs[1]);
    fireEvent.click(screen.getByTestId('refine-filter-role'));

    const loc = screen.getByTestId('loc').textContent ?? '';
    expect(loc).toContain('/escalations/available');
    expect(loc).toContain('role=policy-document');
    expect(loc).toContain('"owner":"Legal"');
    expect(loc).toContain('"po":"PO-9"');
  });

  it('search everywhere drops the role scope', () => {
    render(
      <EscalationListView role="policy-document" listSchema={SCHEMA} activeEscalations={[makeRow()]} />,
    );
    fireEvent.click(screen.getByTestId('row-refine'));
    fireEvent.click(screen.getAllByTestId('refine-pair')[0]);
    fireEvent.click(screen.getByTestId('refine-search-all'));

    const loc = screen.getByTestId('loc').textContent ?? '';
    expect(loc).not.toContain('role=');
    expect(loc).toContain('"owner":"Legal"');
  });

  it('a single fact arrives preselected — the two-tap path', () => {
    render(
      <EscalationListView
        role="policy-document"
        listSchema={{ ...SCHEMA, 'x-lt-columns': [{ label: 'Owner', value: '{{metadata.owner}}' }] }}
        activeEscalations={[makeRow()]}
      />,
    );
    fireEvent.click(screen.getByTestId('row-refine'));
    fireEvent.click(screen.getByTestId('refine-filter-role'));

    expect(screen.getByTestId('loc').textContent).toContain('"owner":"Legal"');
  });

  it('Add to filters merges the selection into the live filter set', () => {
    const onAddFacet = vi.fn();
    render(
      <EscalationListView
        role="policy-document"
        listSchema={SCHEMA}
        activeEscalations={[makeRow()]}
        onAddFacet={onAddFacet}
      />,
    );
    fireEvent.click(screen.getByTestId('row-refine'));
    const pairs = screen.getAllByTestId('refine-pair');
    fireEvent.click(pairs[0]);
    fireEvent.click(pairs[1]);
    fireEvent.click(screen.getByTestId('refine-add-filters'));

    expect(onAddFacet).toHaveBeenCalledWith('owner', 'Legal');
    expect(onAddFacet).toHaveBeenCalledWith('po', 'PO-9');
  });

  it('the actions stay disabled until a fact is selected', () => {
    render(
      <EscalationListView role="policy-document" listSchema={SCHEMA} activeEscalations={[makeRow()]} />,
    );
    fireEvent.click(screen.getByTestId('row-refine'));
    expect(screen.getByTestId('refine-filter-role')).toBeDisabled();
    expect(screen.getByTestId('refine-search-all')).toBeDisabled();
  });
});
