import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { PropertiesEditor } from '../PropertiesEditor';

// The generic dictionary editor emits ATOMIC patch ops — one op per gesture,
// never the whole dictionary.

const VALUE = { badge_id: 'B-1001', shift: 'day' };

describe('PropertiesEditor', () => {
  it('renders the dictionary and an empty state when there is none', () => {
    const { rerender } = render(<PropertiesEditor value={VALUE} onPatch={vi.fn()} />);
    expect(screen.getByText('badge_id')).toBeInTheDocument();
    expect(screen.getByText('day')).toBeInTheDocument();
    rerender(<PropertiesEditor value={{}} onPatch={vi.fn()} />);
    expect(screen.getByText(/No properties/)).toBeInTheDocument();
  });

  it('adding a property emits a single set op — values JSON-parse with string fallback', () => {
    const onPatch = vi.fn();
    render(<PropertiesEditor value={VALUE} onPatch={onPatch} />);
    fireEvent.change(screen.getByLabelText('New property name'), { target: { value: 'max_stations' } });
    fireEvent.change(screen.getByLabelText('New property value'), { target: { value: '3' } });
    fireEvent.click(screen.getByText('Add Property'));
    expect(onPatch).toHaveBeenCalledWith({ set: { max_stations: 3 } });
  });

  it('rejects a duplicate property name inline without emitting', () => {
    const onPatch = vi.fn();
    render(<PropertiesEditor value={VALUE} onPatch={onPatch} />);
    fireEvent.change(screen.getByLabelText('New property name'), { target: { value: 'shift' } });
    fireEvent.click(screen.getByText('Add Property'));
    expect(onPatch).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('"shift" already exists');
  });

  it('editing a value emits set; renaming emits rename — value preserved server-side', () => {
    const onPatch = vi.fn();
    render(<PropertiesEditor value={VALUE} onPatch={onPatch} />);
    fireEvent.click(screen.getByTitle('Edit shift'));
    fireEvent.change(screen.getByLabelText('Property value'), { target: { value: 'night' } });
    fireEvent.click(screen.getByText('Save'));
    expect(onPatch).toHaveBeenCalledWith({ set: { shift: 'night' } });

    fireEvent.click(screen.getByTitle('Edit shift'));
    fireEvent.change(screen.getByLabelText('Property name'), { target: { value: 'work_shift' } });
    fireEvent.click(screen.getByText('Save'));
    expect(onPatch).toHaveBeenLastCalledWith({ rename: { shift: 'work_shift' } });
  });

  it('deleting requires confirmation and emits an explicit remove', () => {
    const onPatch = vi.fn();
    render(<PropertiesEditor value={VALUE} onPatch={onPatch} />);
    fireEvent.click(screen.getByTitle('Edit shift'));
    fireEvent.click(screen.getByText('Remove'));
    expect(onPatch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Yes'));
    expect(onPatch).toHaveBeenCalledWith({ remove: ['shift'] });
  });

  it('a system key is marked and its edit sits behind a confirm step', () => {
    const onPatch = vi.fn();
    render(<PropertiesEditor value={VALUE} systemKeys={['badge_id']} onPatch={onPatch} />);
    expect(screen.getByTitle('system')).toBeInTheDocument();

    fireEvent.click(screen.getByTitle('Edit badge_id'));
    expect(screen.getByText(/system property/)).toBeInTheDocument();
    fireEvent.click(screen.getByText('Edit'));
    fireEvent.change(screen.getByLabelText('Property value'), { target: { value: 'B-9999' } });
    fireEvent.click(screen.getByText('Save'));
    expect(onPatch).toHaveBeenCalledWith({ set: { badge_id: 'B-9999' } });
  });

  it('surfaces the owner\'s patch error (e.g. an identity 409) inline', () => {
    render(<PropertiesEditor value={VALUE} error={'"badge_id" value is already bound to another active user'} onPatch={vi.fn()} />);
    expect(screen.getByRole('alert')).toHaveTextContent('already bound');
  });
});
