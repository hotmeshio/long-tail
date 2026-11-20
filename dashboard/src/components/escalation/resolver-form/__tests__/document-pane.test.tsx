import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { FieldRow } from '../FieldRow';
import { DocumentLocatorContext, createDocumentLocator } from '../document-pane';

describe('document locator', () => {
  it('takes the named document to the target and does nothing with no target', () => {
    const locator = createDocumentLocator();
    const go = vi.fn();
    locator.register({ key: 'scan', sources: ['file.review'] }, go);
    expect(locator.locate('file.review', { page: 3 })).toBe(true);
    expect(go).toHaveBeenCalledWith({ page: 3 });
    expect(locator.locate('scan', { quote: 'callus' })).toBe(true);
    expect(locator.locate(undefined, {})).toBe(false);
    expect(locator.locate('file.other', { page: 1 })).toBe(false);
  });

  it('uses the first document when an item names none, and forgets one that unmounts', () => {
    const locator = createDocumentLocator();
    const first = vi.fn();
    const second = vi.fn();
    const off = locator.register({ key: 'a', sources: [] }, first);
    locator.register({ key: 'b', sources: [] }, second);
    locator.locate(undefined, { page: 2 });
    expect(first).toHaveBeenCalledWith({ page: 2 });
    off();
    locator.locate(undefined, { page: 4 });
    expect(second).toHaveBeenCalledWith({ page: 4 });
  });
});

describe('a list item points at the document', () => {
  const schema = {
    properties: {
      evidence: {
        type: 'array',
        title: 'Evidence',
        'x-lt-widget': 'rows',
        'x-lt-locate': { file: 'file.review', page: 'page', quote: 'quote' },
        items: { type: 'object', properties: { quote: { type: 'string' }, page: { type: 'integer' } } },
      },
    },
  };
  const rows = [{ quote: 'Callus at 1st metatarsal head.', page: 2 }, { quote: 'No page here' }];

  const draw = (locator = createDocumentLocator()) => {
    const go = vi.fn();
    locator.register({ key: 'doc', sources: ['file.review'] }, go);
    render(
      <DocumentLocatorContext.Provider value={locator}>
        <FieldRow fieldKey="evidence" value={rows as any} onChange={() => {}} schema={schema} />
      </DocumentLocatorContext.Provider>,
    );
    return go;
  };

  it('focusing a row scrolls the document to its page and quote', () => {
    const go = draw();
    fireEvent.focus(document.getElementById('lt-field-evidence.0.quote')!);
    expect(go).toHaveBeenCalledWith({ page: 2, quote: 'Callus at 1st metatarsal head.' });
  });

  it('a row with no page still searches by its quote, and moving between its cells does not repeat', () => {
    const go = draw();
    fireEvent.focus(document.getElementById('lt-field-evidence.1.quote')!);
    expect(go).toHaveBeenLastCalledWith({ page: undefined, quote: 'No page here' });
    fireEvent.focus(document.getElementById('lt-field-evidence.1.page')!);
    expect(go).toHaveBeenCalledTimes(1);
  });

  it('does nothing and does not error when the form has no document', () => {
    render(<FieldRow fieldKey="evidence" value={rows as any} onChange={() => {}} schema={schema} />);
    expect(() => fireEvent.focus(document.getElementById('lt-field-evidence.0.quote')!)).not.toThrow();
    expect(screen.getByText('Evidence')).toBeTruthy();
  });
});
