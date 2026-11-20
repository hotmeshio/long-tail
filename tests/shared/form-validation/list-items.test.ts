import { describe, it, expect } from 'vitest';

import { validateField, validateListItems, validateResolverPayload } from '../../../shared/form-validation';

const CODES = {
  type: ['array', 'null'],
  items: { type: 'string', pattern: '^[A-Z][0-9]{2}$' },
  uniqueItems: true,
  maxItems: 3,
};
const LINES = {
  type: ['array', 'null'],
  'x-lt-bind': 'facts.lines',
  items: {
    type: 'object',
    required: ['code', 'qty'],
    properties: {
      code: { type: 'string', title: 'Code' },
      qty: { type: 'integer', title: 'Qty', minimum: 1 },
      side: { type: 'string', title: 'Side', enum: ['left', 'right'] },
      detail: { type: 'string', title: 'Detail', 'x-lt-showIf': 'row.side=left' },
      tags: { type: 'array', title: 'Tags', items: { type: 'string', maxLength: 3 } },
    },
  },
};
const err = (value: unknown, schema: Record<string, unknown>, required = false) => validateField(value, schema, required, true);

describe('scalar items', () => {
  it('checks every item and names the failing one', () => {
    expect(err(['E11', 'bad'], CODES)).toBe('Item 2: Invalid format');
    expect(err(['E11', 'F22'], CODES)).toBeUndefined();
  });

  it('refuses a duplicate under uniqueItems', () => {
    expect(err(['E11', 'E11'], CODES)).toBe('Item 2: Duplicate value');
  });

  it('applies the nullable type: a list type checks, null passes unless required', () => {
    expect(err('E11', CODES)).toBe('Expected a list');
    expect(err(null, CODES)).toBeUndefined();
    expect(err(null, CODES, true)).toBe('Required');
    expect(err([], CODES, true)).toBe('Required');
  });

  it('enforces maxItems before items', () => {
    expect(err(['A11', 'B22', 'C33', 'D44'], CODES)).toBe('At most 3 items');
  });
});

describe('rows', () => {
  it('requires declared cells and reports Row N, Label', () => {
    expect(err([{ code: 'A5500' }], LINES)).toBe('Row 1, Qty: Required');
    expect(err([{ code: 'A5500', qty: 0 }], LINES)).toBe('Row 1, Qty: Minimum value is 1');
    expect(err([{ code: 'A5500', qty: 2 }], LINES)).toBeUndefined();
  });

  it('checks cell enums and nested lists', () => {
    expect(err([{ code: 'a', qty: 1, side: 'up' }], LINES)).toBe('Row 1, Side: Must be one of: left, right');
    expect(err([{ code: 'a', qty: 1, tags: ['abcd'] }], LINES)).toBe('Row 1, Tags: Item 1: Maximum 3 characters (4 entered)');
  });

  it('reads the row in a cell showIf', () => {
    const rows = [{ code: 'a', qty: 1, side: 'right', detail: 42 }];
    expect(validateListItems(rows, LINES, undefined)).toEqual([]);
    const shown = [{ code: 'a', qty: 1, side: 'left', detail: 42 }];
    expect(validateListItems(shown, LINES, undefined)[0].message).toBe('Row 1, Detail: Expected text');
  });

  it('keeps undeclared properties unless additionalProperties is false', () => {
    const row = [{ code: 'a', qty: 1, extra: 'kept' }];
    expect(validateListItems(row, LINES, undefined)).toEqual([]);
    const strict = { ...LINES, items: { ...LINES.items, additionalProperties: false } };
    expect(validateListItems(row, strict, undefined)[0].message).toBe('Row 1: Unknown field "extra"');
  });

  it('gives every error a pointer relative to the list', () => {
    const errors = validateListItems([{ code: 'a', qty: 1 }, { code: 'b', qty: 0 }], LINES, undefined);
    expect(errors).toEqual([{ index: 1, cell: 'qty', message: 'Row 2, Qty: Minimum value is 1', pointer: '/1/qty' }]);
  });
});

describe('payload validation', () => {
  const schema = { properties: { lines: LINES } };

  it('puts a JSON pointer through the bind path on an item-level violation', () => {
    const payload = { facts: { lines: [{ code: 'a', qty: 1 }, { code: 'b', qty: 0 }] } };
    expect(validateResolverPayload(schema, payload)).toEqual([
      { field: 'lines', message: 'Row 2, Qty: Minimum value is 1', pointer: '/facts/lines/1/qty' },
    ]);
  });

  it('adds no pointer to a field-level violation', () => {
    expect(validateResolverPayload({ required: ['lines'], properties: { lines: LINES } }, { facts: { lines: [] } }))
      .toEqual([{ field: 'lines', message: 'Required' }]);
  });
});
