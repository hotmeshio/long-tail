import { describe, it, expect } from 'vitest';
import {
  partitionCells,
  isDictionaryField,
  sectionOptionsFor,
  type FormEntry,
} from '../resolver-form/form-cells';

const entries = (obj: Record<string, unknown>): FormEntry[] =>
  Object.entries(obj) as FormEntry[];

describe('isDictionaryField', () => {
  it('requires readOnly', () => {
    const schema = { 'x-lt-display': 'dictionary', properties: { a: { type: 'string' } } };
    expect(isDictionaryField(schema, null, 'a')).toBe(false);
  });

  it('honors schema-root display for readOnly fields', () => {
    const schema = { 'x-lt-display': 'dictionary', properties: { a: { readOnly: true } } };
    expect(isDictionaryField(schema, null, 'a')).toBe(true);
  });

  it('honors section-level options', () => {
    const schema = {
      'x-lt-section-options': { Facts: { display: 'dictionary' } },
      properties: { a: { readOnly: true, 'x-lt-section': 'Facts' } },
    };
    expect(isDictionaryField(schema, 'Facts', 'a')).toBe(true);
    expect(isDictionaryField(schema, 'Other', 'a')).toBe(false);
  });

  it('field-level display overrides section and root', () => {
    const schema = {
      'x-lt-display': 'dictionary',
      properties: {
        a: { readOnly: true, 'x-lt-display': 'default' },
        b: { readOnly: true },
      },
    };
    expect(isDictionaryField(schema, null, 'a')).toBe(false);
    expect(isDictionaryField(schema, null, 'b')).toBe(true);
  });

  it('content widgets never render as dictionary rows', () => {
    const schema = {
      'x-lt-display': 'dictionary',
      properties: { a: { readOnly: true, 'x-lt-widget': 'markdown' } },
    };
    expect(isDictionaryField(schema, null, 'a')).toBe(false);
  });
});

describe('partitionCells', () => {
  it('merges consecutive dictionary fields into one cell', () => {
    const schema = {
      'x-lt-display': 'dictionary',
      properties: {
        po: { readOnly: true },
        order_id: { readOnly: true },
        approved: { type: 'boolean' },
      },
    };
    const cells = partitionCells(entries({ po: 'x', order_id: 'y', approved: false }), schema, null, undefined);
    expect(cells.map((c) => c.kind)).toEqual(['dictionary', 'field']);
    expect(cells[0].kind === 'dictionary' && cells[0].entries.map(([k]) => k)).toEqual(['po', 'order_id']);
  });

  it('groups consecutive column-group fields in two-column layout', () => {
    const schema = {
      properties: {
        left: { 'x-lt-column-group': 'qty' },
        right: { 'x-lt-column-group': 'qty' },
        notes: {},
      },
    };
    const cells = partitionCells(entries({ left: 1, right: 1, notes: '' }), schema, null, 'two-column');
    expect(cells.map((c) => c.kind)).toEqual(['column-group', 'field']);
    expect(cells[0].kind === 'column-group' && cells[0].entries.length).toBe(2);
  });

  it('ignores column groups outside two-column layout', () => {
    const schema = {
      properties: {
        left: { 'x-lt-column-group': 'qty' },
        right: { 'x-lt-column-group': 'qty' },
      },
    };
    const cells = partitionCells(entries({ left: 1, right: 1 }), schema, null, undefined);
    expect(cells.map((c) => c.kind)).toEqual(['field', 'field']);
  });

  it('separates column groups with different names', () => {
    const schema = {
      properties: {
        a: { 'x-lt-column-group': 'one' },
        b: { 'x-lt-column-group': 'two' },
      },
    };
    const cells = partitionCells(entries({ a: 1, b: 2 }), schema, null, 'two-column');
    expect(cells.map((c) => c.kind)).toEqual(['column-group', 'column-group']);
  });
});

describe('sectionOptionsFor', () => {
  it('returns options for a named section and undefined otherwise', () => {
    const schema = { 'x-lt-section-options': { Facts: { display: 'dictionary', columns: 1 } } };
    expect(sectionOptionsFor(schema, 'Facts')).toEqual({ display: 'dictionary', columns: 1 });
    expect(sectionOptionsFor(schema, 'Missing')).toBeUndefined();
    expect(sectionOptionsFor(schema, null)).toBeUndefined();
  });
});
