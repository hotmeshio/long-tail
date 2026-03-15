import { render, screen } from '@testing-library/react';
import { PriorityBadge } from '../display/PriorityBadge';

describe('PriorityBadge', () => {
  it.each([
    [1, 'P1'],
    [2, 'P2'],
    [3, 'P3'],
    [4, 'P4'],
  ])('renders priority %d as "%s"', (priority, label) => {
    render(<PriorityBadge priority={priority} />);
    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it('falls back to P{n} for unknown priority values', () => {
    render(<PriorityBadge priority={7} />);
    expect(screen.getByText('P7')).toBeInTheDocument();
  });
});
