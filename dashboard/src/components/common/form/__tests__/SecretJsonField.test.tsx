import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SecretJsonField, hasSecretValues, maskJsonValues } from '../SecretJsonField';

const SAVED = JSON.stringify({ Authorization: 'Bearer lt_bot_secret' }, null, 2);

describe('maskJsonValues', () => {
  it('keeps keys and masks every value', () => {
    const masked = maskJsonValues(SAVED);
    expect(masked).toContain('"Authorization"');
    expect(masked).not.toContain('lt_bot_secret');
  });

  it('masks unparseable text whole', () => {
    expect(maskJsonValues('{ "Authorization": "Bearer x"')).not.toContain('Bearer');
  });
});

describe('hasSecretValues', () => {
  it('is false for empty text and an empty object', () => {
    expect(hasSecretValues('')).toBe(false);
    expect(hasSecretValues('{}')).toBe(false);
  });

  it('is true for an object with keys or text that does not parse', () => {
    expect(hasSecretValues(SAVED)).toBe(true);
    expect(hasSecretValues('{ "a": ')).toBe(true);
  });
});

describe('SecretJsonField', () => {
  it('masks saved values and makes the field read-only', () => {
    render(<SecretJsonField label="Headers (JSON)" value={SAVED} onChange={() => {}} />);
    const field = screen.getByLabelText('Headers (JSON)') as HTMLTextAreaElement;
    expect(field.value).not.toContain('lt_bot_secret');
    expect(field).toHaveAttribute('readonly');
  });

  it('shows the real value on Show and masks it again on Hide', () => {
    render(<SecretJsonField label="Headers (JSON)" value={SAVED} onChange={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /show/i }));
    const field = screen.getByLabelText('Headers (JSON)') as HTMLTextAreaElement;
    expect(field.value).toContain('lt_bot_secret');
    expect(field).not.toHaveAttribute('readonly');
    fireEvent.click(screen.getByRole('button', { name: /hide/i }));
    expect(field.value).not.toContain('lt_bot_secret');
  });

  it('starts editable when there is nothing to hide and stays shown while typing', () => {
    const onChange = vi.fn();
    const { rerender } = render(<SecretJsonField label="Headers (JSON)" value="{}" onChange={onChange} />);
    const field = screen.getByLabelText('Headers (JSON)') as HTMLTextAreaElement;
    expect(field).not.toHaveAttribute('readonly');
    fireEvent.change(field, { target: { value: SAVED } });
    expect(onChange).toHaveBeenCalledWith(SAVED);
    rerender(<SecretJsonField label="Headers (JSON)" value={SAVED} onChange={onChange} />);
    expect(field.value).toContain('lt_bot_secret');
  });

  it('copies the real value while masked', () => {
    const writeText = vi.fn();
    Object.assign(navigator, { clipboard: { writeText } });
    render(<SecretJsonField label="Headers (JSON)" value={SAVED} onChange={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /copy/i }));
    expect(writeText).toHaveBeenCalledWith(SAVED);
  });
});
