import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';

import { FieldRow } from '../FieldRow';
import { DictionaryList } from '../DictionaryList';

const schemaFor = (field: Record<string, unknown>) => ({ type: 'object', properties: { notes: { type: 'string', ...field } } });

function renderField(value: string, field: Record<string, unknown> = {}, isReadOnly = false) {
  return render(<FieldRow fieldKey="notes" value={value} onChange={vi.fn()} schema={schemaFor(field)} isReadOnly={isReadOnly} />);
}

describe('FieldRow text controls', () => {
  it('x-lt-widget textarea renders a textarea for short text', () => {
    const { container } = renderField('short', { 'x-lt-widget': 'textarea' });
    expect(container.querySelector('textarea')).not.toBeNull();
  });

  it('format textarea still renders a textarea', () => {
    const { container } = renderField('short', { format: 'textarea' });
    expect(container.querySelector('textarea')).not.toBeNull();
  });

  it('multi-line text renders a textarea and keeps its line breaks', () => {
    const { container } = renderField('line one\nline two');
    const area = container.querySelector('textarea');
    expect(area).not.toBeNull();
    expect(area!.value).toBe('line one\nline two');
  });

  it('short single-line text stays an input', () => {
    const { container } = renderField('short');
    expect(container.querySelector('textarea')).toBeNull();
    expect(container.querySelector('input[type="text"]')).not.toBeNull();
  });

  it('a read-only textarea field shows its line breaks', () => {
    const { container } = renderField('a\nb', { 'x-lt-widget': 'textarea' }, true);
    const text = container.querySelector('p.whitespace-pre-wrap');
    expect(text?.textContent).toBe('a\nb');
  });
});

describe('DictionaryList', () => {
  it('keeps line breaks in a value', () => {
    const { container } = render(<DictionaryList items={[{ key: 'notes', label: 'Notes', value: 'a\nb' }]} />);
    const dd = container.querySelector('dd[data-field-key="notes"]')!;
    expect(dd.className).toContain('whitespace-pre-wrap');
    expect(dd.textContent).toBe('a\nb');
  });
});
