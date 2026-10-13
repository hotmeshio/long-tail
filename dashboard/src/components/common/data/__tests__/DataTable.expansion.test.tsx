import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { DataTable } from '../DataTable';

type Row = { id: string; open: boolean };
const columns = [{ key: 'id', label: 'Id', render: (r: Row) => r.id }];
const data: Row[] = [{ id: 'a', open: true }, { id: 'b', open: false }];
const expansion = (r: Row) => (r.open ? <div data-testid={`more-${r.id}`}>more {r.id}</div> : null);

describe('DataTable row expansion', () => {
  it('renders a full-width row under an expanded row only', () => {
    render(<DataTable columns={columns} data={data} keyFn={(r) => r.id} renderExpansion={expansion} fold="never" />);
    const expanded = screen.getAllByTestId('row-expansion');
    expect(expanded).toHaveLength(1);
    expect(expanded[0].querySelector('td')?.getAttribute('colspan')).toBe('1');
    expect(screen.getByTestId('more-a')).toBeTruthy();
    expect(screen.queryByTestId('more-b')).toBeNull();
  });

  it('renders the expansion at the foot of the card when folded', () => {
    render(<DataTable columns={columns} data={data} keyFn={(r) => r.id} renderExpansion={expansion} forceCardMode />);
    expect(screen.getByTestId('more-a')).toBeTruthy();
    expect(screen.queryByTestId('row-expansion')).toBeNull();
  });
});
