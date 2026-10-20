import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi } from 'vitest';

const useRelatedAggregates = vi.fn();
vi.mock('../../../../api/escalation-related', () => ({
  useRelatedAggregates: (...a: unknown[]) => useRelatedAggregates(...a),
  useRelatedRows: () => ({ isLoading: false, data: undefined }),
}));
vi.mock('../../../../hooks/useEventHooks', () => ({ useRelatedSetEvents: vi.fn() }));
vi.mock('../../../../api/escalations', () => ({ useClaimEscalation: () => ({ mutate: vi.fn(), isPending: false }) }));

import { FacetTable } from '../FacetTable';
import type { LTEscalationRecord } from '../../../../api/types';

const row = (id: string, metadata: Record<string, unknown>) => ({
  id, role: 'consolidate', status: 'pending', priority: 2, metadata, type: 'rollup', subtype: 'bin',
  envelope: '{}', escalation_payload: null, resolver_payload: null, assigned_to: null, assigned_until: null,
  created_at: '2026-10-13T12:00:00Z', updated_at: '2026-10-13T12:00:00Z',
}) as unknown as LTEscalationRecord;

// A count read through its display and a min over item payloads, each from its own key.
const schema = {
  'x-lt-layout': 'facet-table',
  'x-lt-related': { contents: { source: 'items' } },
  'x-lt-columns': [
    { label: 'Bin', value: '{{metadata.binKey}}' },
    { label: 'Coming', related: 'contents', display: { '0': 'Ready', default: 'Waiting on {n}' } },
    { label: 'Heaviest', related: 'contents', aggregate: 'max', value: '{{item.payload.weight}}' },
  ],
};

describe('facet-table related values', () => {
  it('renders a display count and a max from their own aggregate keys', () => {
    useRelatedAggregates.mockReturnValue({
      isLoading: false,
      data: { version: 1, sets: { contents: { source: 'items', aggregates: {
        '': { a: { count: 0 }, b: { count: 2 } },
        'max:payload.weight': { a: { count: 0 }, b: { count: 2, value: 12 } },
      } } } },
    });
    render(<MemoryRouter><FacetTable schema={schema} rows={[row('a', { binKey: 'A' }), row('b', { binKey: 'B' })]} role="consolidate" /></MemoryRouter>);
    expect(screen.getAllByTestId('related-count').map((c) => c.textContent)).toEqual(['Ready', 'Waiting on 2']);
    const cells = screen.getAllByTestId('related-cell');
    expect(cells[cells.length - 1].textContent).toBe('12');
  });
});
