import { render, screen } from '@testing-library/react';
import { StatusBadge } from '../display/StatusBadge';

describe('StatusBadge', () => {
  it.each([
    ['pending', 'Pending'],
    ['in_progress', 'In Progress'],
    ['completed', 'Completed'],
    ['resolved', 'Resolved'],
    ['needs_intervention', 'Needs Intervention'],
    ['cancelled', 'Cancelled'],
  ])('renders "%s" as "%s"', (status, label) => {
    render(<StatusBadge status={status} />);
    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it('falls back to raw status string for unknown values', () => {
    render(<StatusBadge status="custom_status" />);
    expect(screen.getByText('custom_status')).toBeInTheDocument();
  });
});
