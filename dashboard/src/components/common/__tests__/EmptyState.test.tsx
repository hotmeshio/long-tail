import { render, screen } from '@testing-library/react';
import { EmptyState } from '../EmptyState';

describe('EmptyState', () => {
  it('renders default title when none is provided', () => {
    render(<EmptyState />);
    expect(screen.getByText('No data')).toBeInTheDocument();
  });

  it('renders custom title', () => {
    render(<EmptyState title="Nothing here" />);
    expect(screen.getByText('Nothing here')).toBeInTheDocument();
  });

  it('renders description when provided', () => {
    render(<EmptyState description="Try adjusting your filters" />);
    expect(screen.getByText('Try adjusting your filters')).toBeInTheDocument();
  });

  it('omits description element when not provided', () => {
    const { container } = render(<EmptyState />);
    const paragraphs = container.querySelectorAll('p');
    expect(paragraphs).toHaveLength(1);
  });
});
