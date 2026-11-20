import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { FieldRow } from '../FieldRow';

const schema = {
  properties: {
    conditions: {
      type: ['array', 'null'],
      title: 'Conditions',
      items: { type: 'string' },
      'x-lt-options': [
        { value: 'neuropathy', label: 'Peripheral neuropathy' },
        { value: 'deformity', label: 'Foot deformity' },
      ],
    },
  },
};
const draw = (value: unknown, onChange = vi.fn()) => {
  render(<FieldRow fieldKey="conditions" value={value as any} onChange={onChange} schema={schema} />);
  return onChange;
};

describe('closed-set chips', () => {
  it('treats a nullable type as a list and draws the chips', () => {
    draw(null);
    expect(screen.getByTestId('multi-select-conditions-neuropathy')).toBeTruthy();
  });

  it('keeps a proposed value outside the options as a warning pill until it is removed', () => {
    const onChange = draw(['neuropathy', 'legacy_value']);
    const pill = screen.getByText('legacy_value').closest('[data-pill]')!;
    expect(pill.getAttribute('data-tone')).toBe('warning');
    expect(pill.getAttribute('title')).toBe('Not a known option');
    fireEvent.click(screen.getByTestId('multi-select-conditions-deformity'));
    expect(onChange).toHaveBeenLastCalledWith(['neuropathy', 'deformity', 'legacy_value']);
    fireEvent.click(screen.getByLabelText('Remove legacy_value'));
    expect(onChange).toHaveBeenLastCalledWith(['neuropathy']);
  });
});
