import { render, screen } from '@testing-library/react';
import { Field } from '../data/Field';

describe('Field', () => {
  it('renders label and value', () => {
    render(<Field label="Status" value="Active" />);
    expect(screen.getByText('Status')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
  });

  it('renders em-dash when value is null', () => {
    render(<Field label="Name" value={null} />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('renders em-dash when value is undefined', () => {
    render(<Field label="Name" value={undefined} />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('renders ReactNode values', () => {
    render(<Field label="Link" value={<a href="#">Click me</a>} />);
    expect(screen.getByText('Click me')).toBeInTheDocument();
  });
});
