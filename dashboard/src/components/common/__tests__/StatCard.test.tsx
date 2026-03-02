import { render, screen } from '@testing-library/react';
import { StatCard } from '../StatCard';

describe('StatCard', () => {
  it('renders label and value', () => {
    render(<StatCard label="Total Tasks" value={42} />);
    expect(screen.getByText('Total Tasks')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
  });

  it('renders string values', () => {
    render(<StatCard label="Status" value="OK" />);
    expect(screen.getByText('OK')).toBeInTheDocument();
  });

  it('renders sub text when provided', () => {
    render(<StatCard label="Active" value={5} sub="out of 10" />);
    expect(screen.getByText('out of 10')).toBeInTheDocument();
  });

  it('omits sub text when not provided', () => {
    const { container } = render(<StatCard label="Count" value={1} />);
    const paragraphs = container.querySelectorAll('p');
    expect(paragraphs).toHaveLength(2); // label + value only
  });

  it('renders dot indicator when dotClass is provided', () => {
    const { container } = render(
      <StatCard label="Running" value={3} dotClass="bg-green-500" />,
    );
    const dot = container.querySelector('.rounded-full');
    expect(dot).toBeInTheDocument();
    expect(dot).toHaveClass('bg-green-500');
  });

  it('omits dot when dotClass is not provided', () => {
    const { container } = render(<StatCard label="Count" value={0} />);
    expect(container.querySelector('.rounded-full')).not.toBeInTheDocument();
  });
});
