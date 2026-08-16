import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { PillMultiSelect } from '../PillMultiSelect';

describe('PillMultiSelect', () => {
  it('adds from the remaining options', () => {
    const onChange = vi.fn();
    render(
      <PillMultiSelect values={['a']} options={['a', 'b', 'c']} onChange={onChange} addLabel="Add…" />,
    );
    const select = screen.getByRole('combobox');
    expect(select).not.toHaveTextContent('a');
    fireEvent.change(select, { target: { value: 'b' } });
    expect(onChange).toHaveBeenCalledWith(['a', 'b']);
  });

  it('removes via the pill', () => {
    const onChange = vi.fn();
    render(
      <PillMultiSelect values={['a', 'b']} options={['a', 'b']} onChange={onChange} addLabel="Add…" />,
    );
    fireEvent.click(screen.getByTitle('Remove a'));
    expect(onChange).toHaveBeenCalledWith(['b']);
  });

  it('shows the empty hint and hides the select when nothing remains', () => {
    render(
      <PillMultiSelect values={[]} options={[]} onChange={vi.fn()} addLabel="Add…" emptyText="Everyone" />,
    );
    expect(screen.getByText('Everyone')).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });
});
