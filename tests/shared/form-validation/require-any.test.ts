import { describe, it, expect } from 'vitest';

import {
  validateResolverForm,
  validateResolverPayload,
} from '../../../shared/form-validation';

// x-lt-require-any — each declared group needs a value in at least one
// VISIBLE member. false/0 are answers; ''/null/undefined are not; hidden
// members neither satisfy nor get demanded; malformed tokens are inert.

const SCHEMA = {
  'x-lt-require-any': [['left_quantity', 'right_quantity']],
  properties: {
    left_quantity: { type: 'number', title: 'Left Quantity' },
    right_quantity: { type: 'number', title: 'Right Quantity' },
    notes: { type: 'string' },
  },
} as Record<string, unknown>;

describe('x-lt-require-any', () => {
  it('one filled member satisfies the group — either side works', () => {
    expect(validateResolverForm(SCHEMA, { left_quantity: 2 })).toEqual([]);
    expect(validateResolverForm(SCHEMA, { right_quantity: 1 })).toEqual([]);
  });

  it('blank-both fails with one violation naming the members by title', () => {
    const errors = validateResolverForm(SCHEMA, { notes: 'hi' });
    expect(errors).toEqual([
      {
        field: 'left_quantity',
        message: 'Enter a value for at least one of: Left Quantity, Right Quantity',
      },
    ]);
  });

  it('false and 0 are answers; empty string, null, undefined are not', () => {
    expect(validateResolverForm(SCHEMA, { left_quantity: 0 })).toEqual([]);
    expect(validateResolverForm(SCHEMA, { left_quantity: null })).toHaveLength(1);

    const boolSchema = {
      'x-lt-require-any': [['flag', 'reason']],
      properties: { flag: { type: 'boolean' }, reason: { type: 'string' } },
    };
    expect(validateResolverForm(boolSchema, { flag: false })).toEqual([]);
    expect(validateResolverForm(boolSchema, { reason: '' })).toHaveLength(1);
  });

  it('groups are independent — two unsatisfied groups yield two violations', () => {
    const schema = {
      'x-lt-require-any': [['a', 'b'], ['c', 'd']],
      properties: {
        a: { type: 'string' }, b: { type: 'string' },
        c: { type: 'string' }, d: { type: 'string' },
      },
    };
    const errors = validateResolverForm(schema, {});
    expect(errors.map((e) => e.field)).toEqual(['a', 'c']);
  });

  it('a hidden member cannot satisfy; the violation lands on the first VISIBLE member', () => {
    const schema = {
      'x-lt-require-any': [['hidden_field', 'shown_field']],
      properties: {
        hidden_field: { type: 'string', 'x-lt-showIf': 'resolver.never' },
        shown_field: { type: 'string', title: 'Shown' },
      },
    };
    // hidden_field has a value, but the submitter cannot see it — unsatisfied.
    const errors = validateResolverForm(schema, { hidden_field: 'x' });
    expect(errors).toEqual([
      { field: 'shown_field', message: 'Enter a value for at least one of: Shown' },
    ]);
  });

  it('an all-hidden group is waived; unknown property names read as hidden', () => {
    const schema = {
      'x-lt-require-any': [['ghost_a', 'ghost_b']],
      properties: { notes: { type: 'string' } },
    };
    expect(validateResolverForm(schema, {})).toEqual([]);
  });

  it('malformed tokens are inert', () => {
    for (const bad of ['left||right', [['ok', 42]], [{ group: ['a'] }], 7]) {
      const schema = { 'x-lt-require-any': bad, properties: { ok: { type: 'string' } } };
      // A group reduced to ['ok'] by filtering still enforces; fully-malformed shapes vanish.
      const errors = validateResolverForm(schema as Record<string, unknown>, { ok: 'v' });
      expect(errors).toEqual([]);
    }
  });

  it('composes with plain required — both violations coexist', () => {
    const schema = {
      ...SCHEMA,
      required: ['notes'],
    };
    const errors = validateResolverForm(schema, {});
    expect(errors.map((e) => e.field).sort()).toEqual(['left_quantity', 'notes']);
  });

  it('the API entry point inherits the pass through x-lt-bind inversion', () => {
    const schema = {
      'x-lt-require-any': [['left_quantity', 'right_quantity']],
      properties: {
        left_quantity: { type: 'number', 'x-lt-bind': 'order.left' },
        right_quantity: { type: 'number', 'x-lt-bind': 'order.right' },
      },
    };
    expect(validateResolverPayload(schema, { order: { left: 3 } })).toEqual([]);
    expect(validateResolverPayload(schema, { order: {} })).toHaveLength(1);
  });
});
