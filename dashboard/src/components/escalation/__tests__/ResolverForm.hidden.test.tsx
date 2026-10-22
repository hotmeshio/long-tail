import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ResolverForm } from '../ResolverForm';

// x-lt-hidden: never rendered, and its value stays in the emitted payload.
const schema = {
  properties: {
    type: { type: 'string', title: 'Discriminant', enum: ['release', 'reset'], 'x-lt-hidden': true },
    notes: { type: 'string', title: 'Notes' },
  },
};

describe('ResolverForm: x-lt-hidden', () => {
  it('does not render the field', () => {
    render(<ResolverForm value={JSON.stringify({ type: 'reset', notes: '', _form_schema: schema })} onChange={vi.fn()} />);
    expect(screen.queryByLabelText(/Discriminant/)).not.toBeInTheDocument();
    expect(screen.getByLabelText(/Notes/)).toBeInTheDocument();
  });

  it('keeps its value in the payload when another field changes', () => {
    const onChange = vi.fn();
    render(<ResolverForm value={JSON.stringify({ type: 'reset', notes: '', _form_schema: schema })} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText(/Notes/), { target: { value: 'done' } });
    const emitted = JSON.parse(onChange.mock.calls[onChange.mock.calls.length - 1][0]);
    expect(emitted).toMatchObject({ type: 'reset', notes: 'done' });
  });
});
