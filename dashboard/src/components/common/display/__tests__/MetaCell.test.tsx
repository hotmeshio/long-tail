import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MetaCell } from '../MetaCell';

describe('MetaCell', () => {
  it('renders the label and value content', () => {
    render(<MetaCell label="Status">Resolved</MetaCell>);
    expect(screen.getByText('Status')).toBeInTheDocument();
    expect(screen.getByText('Resolved')).toBeInTheDocument();
  });

  it('grows to fill its share of the row (flex-1) with a light fill, no border', () => {
    const { container } = render(<MetaCell label="Priority">P2</MetaCell>);
    const cell = container.firstElementChild as HTMLElement;
    expect(cell.className).toContain('flex-1');
    expect(cell.className).toContain('bg-surface-sunken/60');
    expect(cell.className).not.toContain('border');
  });

  it('steps type down for nested tiers', () => {
    const { container: c1 } = render(<MetaCell label="A" tier={1}>x</MetaCell>);
    const { container: c3 } = render(<MetaCell label="B" tier={3}>y</MetaCell>);
    // tier 1 value is text-xs; tier 3 is the smaller text-[10px]
    expect(c1.querySelector('.text-xs')).toBeTruthy();
    expect(c3.querySelector('.text-\\[10px\\]')).toBeTruthy();
  });
});
