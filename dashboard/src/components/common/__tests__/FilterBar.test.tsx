import { render, screen, fireEvent } from '@testing-library/react';
import { FilterBar, FilterSelect } from '../data/FilterBar';

describe('FilterBar', () => {
  it('renders children', () => {
    render(
      <FilterBar>
        <span>Filter A</span>
      </FilterBar>,
    );
    expect(screen.getByText('Filter A')).toBeInTheDocument();
  });
});

describe('FilterSelect', () => {
  const options = [
    { value: 'active', label: 'Active' },
    { value: 'inactive', label: 'Inactive' },
  ];

  it('renders label and "All" option', () => {
    render(
      <FilterSelect
        label="Status"
        value=""
        onChange={vi.fn()}
        options={options}
      />,
    );
    expect(screen.getByText('Status')).toBeInTheDocument();
    expect(screen.getByText('All')).toBeInTheDocument();
  });

  it('renders provided options', () => {
    render(
      <FilterSelect
        label="Status"
        value=""
        onChange={vi.fn()}
        options={options}
      />,
    );
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getByText('Inactive')).toBeInTheDocument();
  });

  it('calls onChange when selection changes', () => {
    const onChange = vi.fn();
    render(
      <FilterSelect
        label="Status"
        value=""
        onChange={onChange}
        options={options}
      />,
    );
    fireEvent.change(screen.getByRole('combobox'), {
      target: { value: 'active' },
    });
    expect(onChange).toHaveBeenCalledWith('active');
  });
});
