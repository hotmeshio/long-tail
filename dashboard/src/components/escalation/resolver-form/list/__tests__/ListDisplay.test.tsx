import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { FieldRow } from '../../FieldRow';

const evidence = {
  type: 'array',
  title: 'Callus evidence',
  readOnly: true,
  'x-lt-item-layout': 'evidence',
  'x-lt-item-title': 'quote',
  'x-lt-collapse-after': 2,
};
const ITEMS = [
  { quote: 'Callus at 1st and 5th metatarsal heads.', status: 'current', pre_ulcerative: false, source_section: 'DERMATOLOGICAL' },
  { quote: 'Hammer toes bilaterally.', status: 'current', pre_ulcerative: true },
  { quote: 'Third entry.', status: 'resolved' },
  { quote: 'Fourth entry.', status: 'resolved' },
];
const draw = (value: unknown, def: Record<string, unknown> = evidence, locked = false) =>
  render(<FieldRow fieldKey="ev" value={value as any} onChange={() => {}} schema={{ properties: { ev: def } }} locked={locked} isReadOnly={def.readOnly === true} />);

describe('read-only list display', () => {
  it('shows evidence as a body line with small labeled attributes, booleans as Yes or No', () => {
    draw(ITEMS);
    expect(screen.getByText('Callus at 1st and 5th metatarsal heads.')).toBeTruthy();
    expect(screen.getByText('Source section')).toBeTruthy();
    expect(screen.getByText('DERMATOLOGICAL')).toBeTruthy();
    expect(screen.getAllByText('Pre ulcerative')).toHaveLength(2);
    expect(screen.getByText('No')).toBeTruthy();
    expect(screen.getByText('Yes')).toBeTruthy();
  });

  it('shows the first items and "Show 2 more" past x-lt-collapse-after', () => {
    draw(ITEMS);
    expect(screen.queryByText('Third entry.')).toBeNull();
    fireEvent.click(screen.getByText('Show 2 more'));
    expect(screen.getByText('Fourth entry.')).toBeTruthy();
    fireEvent.click(screen.getByText('Show fewer'));
    expect(screen.queryByText('Third entry.')).toBeNull();
  });

  it('reads null as not stated and an empty list as none', () => {
    draw(null);
    expect(screen.getByText('Not stated')).toBeTruthy();
  });

  it('shows empty as None', () => {
    draw([]);
    expect(screen.getByText('None')).toBeTruthy();
  });

  it('shows a declared rows list as a table with no controls', () => {
    draw([{ code: 'A5500', qty: 2 }], {
      type: 'array',
      title: 'Lines',
      readOnly: true,
      items: { type: 'object', properties: { code: { type: 'string', title: 'HCPCS' }, qty: { type: 'integer', title: 'Qty' } } },
    });
    expect(screen.getByRole('table')).toBeTruthy();
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['HCPCS', 'Qty']);
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('labels option values and falls back to the raw value', () => {
    draw(['neuropathy', 'other'], {
      type: 'array',
      title: 'Conditions',
      readOnly: true,
      items: { type: 'string' },
      'x-lt-options': [{ value: 'neuropathy', label: 'Peripheral neuropathy' }],
    });
    expect(screen.getByText('Peripheral neuropathy')).toBeTruthy();
    expect(screen.getByText('other')).toBeTruthy();
  });

  it('a locked form shows an editable list through the same display', () => {
    draw(['E11.65'], { type: 'array', title: 'Codes', items: { type: 'string' } }, true);
    expect(screen.getByText('E11.65')).toBeTruthy();
    expect(screen.queryByRole('combobox')).toBeNull();
  });
});
