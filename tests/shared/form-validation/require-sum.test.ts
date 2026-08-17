import { describe, it, expect } from 'vitest';

import {
  validateResolverForm,
  validateResolverPayload,
  readRequireSumGroups,
} from '../../../shared/form-validation';

// x-lt-require-sum — each declared group's VISIBLE members must sum to at
// least the group's minimum (default 1). 0 is a real number: defaulted-zero
// quantities do NOT satisfy the group. Hidden members contribute nothing and
// are not demanded; malformed tokens are inert.

const SCHEMA = {
  'x-lt-require-sum': [{ fields: ['left_quantity', 'right_quantity'] }],
  properties: {
    left_quantity: { type: 'number', title: 'Left Quantity' },
    right_quantity: { type: 'number', title: 'Right Quantity' },
    notes: { type: 'string' },
  },
} as Record<string, unknown>;

describe('x-lt-require-sum', () => {
  it('one positive member satisfies the group — either side works', () => {
    expect(validateResolverForm(SCHEMA, { left_quantity: 1, right_quantity: 0 })).toEqual([]);
    expect(validateResolverForm(SCHEMA, { left_quantity: 0, right_quantity: 2 })).toEqual([]);
  });

  it('zero-both fails — unlike require-any, a defaulted 0 is not an answer', () => {
    const errors = validateResolverForm(SCHEMA, { left_quantity: 0, right_quantity: 0 });
    expect(errors).toEqual([
      {
        field: 'left_quantity',
        message: 'Combined value of Left Quantity, Right Quantity must be at least 1',
      },
    ]);
  });

  it('empty and missing members contribute 0; string-typed numeric text coerces', () => {
    expect(validateResolverForm(SCHEMA, {})).toHaveLength(1);
    expect(validateResolverForm(SCHEMA, { left_quantity: '' })).toHaveLength(1);

    const stringSchema = {
      'x-lt-require-sum': [{ fields: ['count_text'] }],
      properties: { count_text: { type: 'string' } },
    };
    expect(validateResolverForm(stringSchema, { count_text: '2' })).toEqual([]);
    expect(validateResolverForm(stringSchema, { count_text: 'abc' })).toHaveLength(1);
  });

  it('an explicit minimum raises the bar and appears in the message', () => {
    const schema = {
      'x-lt-require-sum': [{ fields: ['left_quantity', 'right_quantity'], minimum: 3 }],
      properties: SCHEMA.properties,
    } as Record<string, unknown>;
    expect(validateResolverForm(schema, { left_quantity: 1, right_quantity: 1 })).toEqual([
      {
        field: 'left_quantity',
        message: 'Combined value of Left Quantity, Right Quantity must be at least 3',
      },
    ]);
    expect(validateResolverForm(schema, { left_quantity: 2, right_quantity: 1 })).toEqual([]);
  });

  it('a hidden member contributes nothing; the violation lands on the first VISIBLE member', () => {
    const schema = {
      'x-lt-require-sum': [{ fields: ['hidden_qty', 'shown_qty'] }],
      properties: {
        hidden_qty: { type: 'number', 'x-lt-showIf': 'resolver.never' },
        shown_qty: { type: 'number', title: 'Shown' },
      },
    };
    // hidden_qty carries 5, but the submitter cannot see it — unsatisfied.
    const errors = validateResolverForm(schema, { hidden_qty: 5, shown_qty: 0 });
    expect(errors).toEqual([
      { field: 'shown_qty', message: 'Combined value of Shown must be at least 1' },
    ]);
  });

  it('an all-hidden group is waived; unknown property names read as hidden', () => {
    const schema = {
      'x-lt-require-sum': [{ fields: ['ghost_a', 'ghost_b'] }],
      properties: { notes: { type: 'string' } },
    };
    expect(validateResolverForm(schema, {})).toEqual([]);
  });

  it('malformed tokens are inert', () => {
    for (const bad of ['left+right', [['a', 'b']], [{ fields: 'left' }], [{ fields: [], minimum: 1 }], [{ fields: ['ok'], minimum: 'two' }], 7]) {
      const schema = { 'x-lt-require-sum': bad, properties: { ok: { type: 'number' } } };
      expect(validateResolverForm(schema as Record<string, unknown>, { ok: 0 })).toEqual([]);
    }
    expect(readRequireSumGroups({ 'x-lt-require-sum': [{ fields: ['a', 42, 'b'] }] })).toEqual([
      { fields: ['a', 'b'], minimum: 1 },
    ]);
  });

  it('composes with require-any — the two guards report independently', () => {
    const schema = {
      ...SCHEMA,
      'x-lt-require-any': [['notes']],
    } as Record<string, unknown>;
    const errors = validateResolverForm(schema, { left_quantity: 0, right_quantity: 0 });
    expect(errors.map((e) => e.field).sort()).toEqual(['left_quantity', 'notes']);
  });

  it('the API entry point inherits the pass through x-lt-bind inversion', () => {
    const schema = {
      'x-lt-require-sum': [{ fields: ['left_quantity', 'right_quantity'] }],
      properties: {
        left_quantity: { type: 'number', 'x-lt-bind': 'order.left' },
        right_quantity: { type: 'number', 'x-lt-bind': 'order.right' },
      },
    };
    expect(validateResolverPayload(schema, { order: { left: 3, right: 0 } })).toEqual([]);
    expect(validateResolverPayload(schema, { order: { left: 0, right: 0 } })).toHaveLength(1);
  });
});
