import { render as rtlRender, screen, type RenderOptions } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const render = (ui: React.ReactElement, options?: RenderOptions) =>
  rtlRender(ui, { wrapper: MemoryRouter, ...options });
import { describe, it, expect, vi } from 'vitest';
import { EscalationListView, type ColumnDef } from '../EscalationListView';
import type { LTEscalationRecord } from '../../../api/types';

vi.mock('../../../api/escalations', () => ({
  useEscalations: () => ({ data: undefined, isLoading: false }),
  useClaimEscalation: () => ({ mutate: vi.fn(), isPending: false }),
}));

function makeRow(): LTEscalationRecord {
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
    metadata: { title: 'Refund Policy', station: 'A' },
    escalation_payload: null,
    resolver_payload: null,
    created_at: '2026-07-14T00:00:00.000Z',
    updated_at: '2026-07-14T00:00:00.000Z',
    trace_id: null, span_id: null,
  } as LTEscalationRecord;
}

function schema(columns: ColumnDef[]) {
  return { 'x-lt-layout': 'facet-table', 'x-lt-columns': columns };
}

function headerFor(label: string): HTMLElement {
  return screen.getByRole('columnheader', { name: label });
}

describe('facet-table column widths', () => {
  it('gives the first column 40% when no column declares a width', () => {
    render(
      <EscalationListView
        role="policy-document"
        listSchema={schema([
          { label: 'Title', value: '{{metadata.title}}' },
          { label: 'Station', value: '{{metadata.station}}' },
        ])}
        activeEscalations={[makeRow()]}
      />,
    );
    expect(headerFor('Title')).toHaveStyle({ width: '40%' });
    expect(headerFor('Station').style.width).toBe('');
  });

  it('an authored width wins and suppresses the identity default', () => {
    render(
      <EscalationListView
        role="policy-document"
        listSchema={schema([
          { label: 'Title', value: '{{metadata.title}}' },
          { label: 'Station', value: '{{metadata.station}}', width: '12rem' },
        ])}
        activeEscalations={[makeRow()]}
      />,
    );
    expect(headerFor('Title').style.width).toBe('');
    expect(headerFor('Station')).toHaveStyle({ width: '12rem' });
  });
});
