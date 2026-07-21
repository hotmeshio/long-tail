import { describe, it, expect } from 'vitest';

import { validateResolverForm } from '../../../shared/form-validation';

// ─────────────────────────────────────────────────────────────────────────────
// Presentation tokens — x-lt-display, x-lt-section-options, x-lt-column-group —
// shape how the dashboard lays a form out and carry no validation semantics.
// A schema must validate identically with and without them.
// ─────────────────────────────────────────────────────────────────────────────

const BASE: Record<string, any> = {
  required: ['approved', 'notes'],
  properties: {
    po: { type: 'string', readOnly: true },
    order_id: { type: 'string', readOnly: true },
    left_quantity: { type: 'number', minimum: 0 },
    right_quantity: { type: 'number', minimum: 0 },
    approved: { type: 'boolean' },
    notes: { type: 'string', minLength: 5 },
  },
};

const DECORATED: Record<string, any> = {
  ...BASE,
  'x-lt-layout': 'two-column',
  'x-lt-display': 'dictionary',
  'x-lt-section-options': {
    'The Order': { display: 'dictionary', columns: 2 },
  },
  properties: {
    po: { ...BASE.properties.po, 'x-lt-section': 'The Order' },
    order_id: { ...BASE.properties.order_id, 'x-lt-section': 'The Order', 'x-lt-display': 'dictionary' },
    left_quantity: { ...BASE.properties.left_quantity, 'x-lt-column-group': 'quantities' },
    right_quantity: { ...BASE.properties.right_quantity, 'x-lt-column-group': 'quantities' },
    approved: { ...BASE.properties.approved },
    notes: { ...BASE.properties.notes },
  },
};

const VALID = {
  po: 'Hike Everyday',
  order_id: 'abc-123',
  left_quantity: 1,
  right_quantity: 1,
  approved: true,
  notes: 'looks good',
};

const INVALID = {
  po: 'Hike Everyday',
  order_id: 'abc-123',
  left_quantity: -1,
  right_quantity: 1,
  approved: true,
  notes: 'no',
};

describe('presentation tokens are validation-inert', () => {
  it('a passing form passes identically with and without the tokens', () => {
    expect(validateResolverForm(DECORATED, VALID)).toEqual(validateResolverForm(BASE, VALID));
    expect(validateResolverForm(DECORATED, VALID)).toEqual([]);
  });

  it('a failing form produces identical errors with and without the tokens', () => {
    const plain = validateResolverForm(BASE, INVALID);
    const decorated = validateResolverForm(DECORATED, INVALID);
    expect(decorated).toEqual(plain);
    expect(decorated.map((e) => e.field).sort()).toEqual(['left_quantity', 'notes']);
  });
});
