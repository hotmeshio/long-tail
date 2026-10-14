import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { FieldRow } from '../FieldRow';
import { FieldNoticeProvider } from '../field-notice';
import { applyScanToField } from '../../../../lib/x-lt-scan';

const schema = {
  properties: {
    bags: {
      type: 'array',
      items: { type: 'string' },
      title: 'Bags in the box',
      description: 'Scan each bag as it goes from the tub into the box',
      'x-lt-scan': { schemes: [12], expect: ['metadata.bags'] },
    },
    tags: { type: 'array', items: { type: 'string' }, title: 'Tags', description: 'Labels on the order' },
  },
};
const ctx = { metadata: { bags: ['Q5H45WCX', 'A8HFXCGV', 'KVDXSTPD'] } };

const renderField = (fieldKey: string, value: unknown, onChange = vi.fn(), notice: any = null) =>
  render(
    <FieldNoticeProvider value={notice}>
      <FieldRow fieldKey={fieldKey} value={value as any} onChange={onChange} schema={schema} escalationContext={ctx as any} />
    </FieldNoticeProvider>,
  );

describe('a scan list field is a checklist', () => {
  it('states the instruction and 0 of N while empty, counting against the expected list', () => {
    renderField('bags', []);
    expect(screen.getByTestId('list-field-empty').textContent).toBe('Scan each bag as it goes from the tub into the box');
    expect(screen.getByTestId('list-field-count').textContent).toBe('0 of 3');
  });

  it('counts scans in, and a removed value is admitted again', () => {
    const onChange = vi.fn();
    renderField('bags', ['Q5H45WCX', 'A8HFXCGV'], onChange);
    expect(screen.getByTestId('list-field-count').textContent).toBe('2 of 3');
    fireEvent.click(screen.getByLabelText('Remove Q5H45WCX'));
    expect(onChange).toHaveBeenCalledWith(['A8HFXCGV']);
    const again = applyScanToField(['A8HFXCGV'], { version: 12, target: 'Q5H45WCX', code: '12:0:Q5H45WCX' }, schema.properties.bags, ctx);
    expect(again).toEqual({ ok: true, value: ['A8HFXCGV', 'Q5H45WCX'] });
  });

  it('prefers a declared prompt and reads an unset value as empty', () => {
    const withPrompt = { ...schema.properties.bags, 'x-lt-scan': { schemes: [12], prompt: 'Scan the first bag', maxItems: 2 }, maxItems: 4 };
    render(<FieldRow fieldKey="bags" value={null as any} onChange={vi.fn()} schema={{ properties: { bags: withPrompt } }} />);
    expect(screen.getByTestId('list-field-empty').textContent).toBe('Scan the first bag');
    expect(screen.getByTestId('list-field-count').textContent).toBe('0 of 4');
  });

  it('shows the scan notice under the field it names, and only there', () => {
    renderField('bags', [], vi.fn(), { field: 'bags', error: 'That bag is not in this bin.', at: 1 });
    const notice = screen.getByTestId('field-scan-notice');
    expect(notice.textContent).toBe('That bag is not in this bin.');
    expect(notice.closest('[data-field-key="bags"]')).toBeTruthy();
  });

  it('an accepted scan reads as a status line', () => {
    renderField('bags', ['Q5H45WCX'], vi.fn(), { field: 'bags', error: null, at: 2, message: 'Scanned into Bags in the box' });
    expect(screen.getByRole('status').textContent).toBe('Scanned into Bags in the box');
  });
});

describe('a plain list field displays its values', () => {
  it('renders the description and values, with no count or remove', () => {
    renderField('tags', ['rush', 'fragile']);
    expect(screen.getByText('Labels on the order')).toBeTruthy();
    expect(screen.queryByTestId('list-field-count')).toBeNull();
    expect(screen.queryByTestId('list-field-remove')).toBeNull();
    expect(document.querySelector('[data-field-key="tags"]')).toBeTruthy();
  });
});
