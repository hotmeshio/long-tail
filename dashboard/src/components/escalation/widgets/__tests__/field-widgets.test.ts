import { describe, it, expect } from 'vitest';

import { findUnknownWidgets, isKnownWidget } from '../field-widgets';

describe('isKnownWidget', () => {
  it('knows registered widgets, the textarea alias and json', () => {
    for (const name of ['markdown', 'checklist', 'image', 'textarea', 'json']) {
      expect(isKnownWidget(name)).toBe(true);
    }
  });

  it('an unregistered name is unknown', () => {
    expect(isKnownWidget('text-area')).toBe(false);
  });
});

describe('findUnknownWidgets', () => {
  it('lists unknown widgets by dotted path, nested and under items', () => {
    const schema = {
      type: 'object',
      properties: {
        notes: { type: 'string', 'x-lt-widget': 'textarea' },
        summary: { type: 'string', 'x-lt-widget': 'multiline' },
        box: {
          type: 'object',
          properties: { label: { type: 'string', 'x-lt-widget': 'sticker' } },
        },
        lines: { type: 'array', items: { type: 'object', properties: { code: { 'x-lt-widget': 'barcode' } } } },
      },
    };
    expect(findUnknownWidgets(schema)).toEqual([
      { path: 'summary', widget: 'multiline' },
      { path: 'box.label', widget: 'sticker' },
      { path: 'lines.code', widget: 'barcode' },
    ]);
  });

  it('a schema with only known widgets, or none, has no findings', () => {
    expect(findUnknownWidgets({ properties: { a: { 'x-lt-widget': 'markdown' }, b: { type: 'string' } } })).toEqual([]);
    expect(findUnknownWidgets(null)).toEqual([]);
  });
});
