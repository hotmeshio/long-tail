import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Field, TextField, SelectField, TextArea } from '../Field';

describe('TextField', () => {
  it('renders a core .input control associated with its label', () => {
    render(<TextField label="Customer name" value="Acme" onChange={() => {}} />);
    const input = screen.getByLabelText('Customer name');
    expect(input).toHaveClass('input');
    expect(input.tagName).toBe('INPUT');
  });

  it('marks required and links the hint via aria-describedby', () => {
    render(<TextField label="Email" required hint="Primary contact" value="" onChange={() => {}} />);
    const input = screen.getByLabelText(/Email/);
    expect(input).toHaveAttribute('aria-required', 'true');
    const msgId = input.getAttribute('aria-describedby');
    expect(msgId).toBeTruthy();
    expect(document.getElementById(msgId!)?.textContent).toBe('Primary contact');
  });

  it('shows an error as an alert and sets aria-invalid, hiding the hint', () => {
    render(<TextField label="Email" hint="Primary contact" error="Required" value="" onChange={() => {}} />);
    const input = screen.getByLabelText('Email');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('alert').textContent).toBe('Required');
    expect(screen.queryByText('Primary contact')).not.toBeInTheDocument();
  });

  it('forwards native props and change events', () => {
    const onChange = vi.fn();
    render(<TextField label="Name" placeholder="type here" value="" onChange={onChange} />);
    const input = screen.getByPlaceholderText('type here');
    fireEvent.change(input, { target: { value: 'x' } });
    expect(onChange).toHaveBeenCalled();
  });
});

describe('SelectField', () => {
  it('renders a core .select with options and an optional placeholder', () => {
    render(
      <SelectField
        label="Tier"
        value=""
        onChange={() => {}}
        placeholder="Choose…"
        options={[{ value: 'pro', label: 'Professional' }, { value: 'free', label: 'Free' }]}
      />,
    );
    const select = screen.getByLabelText('Tier');
    expect(select).toHaveClass('select');
    expect(screen.getByRole('option', { name: 'Choose…' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Professional' })).toBeInTheDocument();
  });
});

describe('TextArea', () => {
  it('renders a core .textarea control', () => {
    render(<TextArea label="Notes" value="" onChange={() => {}} />);
    const ta = screen.getByLabelText('Notes');
    expect(ta.tagName).toBe('TEXTAREA');
    expect(ta).toHaveClass('textarea');
  });
});

describe('Field wrapper', () => {
  it('renders label + arbitrary control + hint under one shell', () => {
    render(
      <Field label="Custom" hint="a hint" htmlFor="c1">
        <input id="c1" className="input" />
      </Field>,
    );
    expect(screen.getByLabelText('Custom')).toHaveClass('input');
    expect(screen.getByText('a hint')).toBeInTheDocument();
  });
});
