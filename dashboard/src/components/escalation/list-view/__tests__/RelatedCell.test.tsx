import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect } from 'vitest';

import { RelatedCell } from '../RelatedCell';
import type { RelatedColumnDecl, RelatedHostAggregate } from '../../../../lib/list-schema';

const cell = (col: Partial<RelatedColumnDecl>, agg?: RelatedHostAggregate) =>
  render(
    <MemoryRouter>
      <RelatedCell col={{ label: 'C', related: 's', ...col } as RelatedColumnDecl} agg={agg} />
    </MemoryRouter>,
  );

describe('RelatedCell', () => {
  it('shows the bare count without a display', () => {
    cell({}, { count: 3 });
    expect(screen.getByTestId('related-count').textContent).toBe('3');
  });

  it('reads the count through its display, keeping the count in the tooltip', () => {
    const display = { '0': 'Ready', default: 'Waiting on {n}' };
    const { unmount } = cell({ display }, { count: 0 });
    expect(screen.getByTestId('related-count').textContent).toBe('Ready');
    unmount();
    cell({ display, splitBy: 'payload.kind' }, { count: 2, splits: { a: 2 } });
    expect(screen.getByTestId('related-count').textContent).toBe('Waiting on 2');
    expect(screen.getByTestId('related-cell').getAttribute('title')).toBe('2');
    expect(screen.getByTestId('related-chip').textContent).toBe('a 2');
  });

  it('shows a min or max value, and a dash when no item carries one', () => {
    const { unmount } = cell({ aggregate: 'min', value: '{{item.payload.weight}}' }, { count: 2, value: 4 });
    expect(screen.getByTestId('related-cell').textContent).toBe('4');
    unmount();
    cell({ aggregate: 'max', value: '{{item.payload.weight}}' }, { count: 0 });
    expect(screen.queryByTestId('related-cell')).toBeNull();
    expect(screen.getByText('—')).toBeTruthy();
  });

  it('dashes an unresolved host', () => {
    cell({ display: { '0': 'Ready' } }, { count: 0, unresolved: true });
    expect(screen.queryByTestId('related-count')).toBeNull();
  });
});
