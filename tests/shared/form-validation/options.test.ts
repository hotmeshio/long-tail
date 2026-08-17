import { describe, it, expect } from 'vitest';

import {
  resolveFieldOptions,
  validateResolverForm,
  validateResolverPayload,
} from '../../../shared/form-validation';

// x-lt-options — a select's option list resolved from the escalation context
// at "domain.path". Static enum wins; an unresolvable path yields no options
// and no membership enforcement; non-scalar entries are dropped.

const CTX = {
  envelope: {
    left_quantity_options: [0, 1, 2, 3],
    return_stations: ['molding', 'finishing'],
    nested: { deep: ['a', 'b'] },
    mixed: [1, 'two', { id: 3 }, null, [4]],
    empty: [],
    not_an_array: 'nope',
  },
};

describe('x-lt-options resolution', () => {
  it('resolves a scalar array from the context path', () => {
    expect(resolveFieldOptions({ 'x-lt-options': 'envelope.left_quantity_options' }, CTX))
      .toEqual([0, 1, 2, 3]);
    expect(resolveFieldOptions({ 'x-lt-options': 'envelope.nested.deep' }, CTX))
      .toEqual(['a', 'b']);
  });

  it('a static enum takes precedence over the dynamic path', () => {
    const fieldSchema = { enum: ['x', 'y'], 'x-lt-options': 'envelope.return_stations' };
    expect(resolveFieldOptions(fieldSchema, CTX)).toEqual(['x', 'y']);
  });

  it('unresolvable paths, empty arrays, and non-arrays yield no options', () => {
    expect(resolveFieldOptions({ 'x-lt-options': 'envelope.missing' }, CTX)).toBeUndefined();
    expect(resolveFieldOptions({ 'x-lt-options': 'envelope.empty' }, CTX)).toBeUndefined();
    expect(resolveFieldOptions({ 'x-lt-options': 'envelope.not_an_array' }, CTX)).toBeUndefined();
    expect(resolveFieldOptions({ 'x-lt-options': 'no-dot' }, CTX)).toBeUndefined();
    expect(resolveFieldOptions({ 'x-lt-options': 'ghost.path' }, CTX)).toBeUndefined();
    expect(resolveFieldOptions({ 'x-lt-options': 'envelope.left_quantity_options' }, undefined)).toBeUndefined();
  });

  it('non-scalar entries are dropped', () => {
    expect(resolveFieldOptions({ 'x-lt-options': 'envelope.mixed' }, CTX)).toEqual([1, 'two']);
  });
});

describe('x-lt-options membership enforcement', () => {
  const SCHEMA = {
    properties: {
      left_quantity: { type: 'number', 'x-lt-options': 'envelope.left_quantity_options' },
      designation: { type: 'string', 'x-lt-options': 'envelope.return_stations' },
    },
  } as Record<string, unknown>;

  it('a value in the resolved list passes; one outside it fails', () => {
    expect(validateResolverForm(SCHEMA, { left_quantity: 2, designation: 'molding' }, CTX)).toEqual([]);
    const errors = validateResolverForm(SCHEMA, { left_quantity: 7, designation: 'molding' }, CTX);
    expect(errors).toEqual([
      { field: 'left_quantity', message: 'Must be one of: 0, 1, 2, 3' },
    ]);
  });

  it('string options are enforced the same way', () => {
    const errors = validateResolverForm(SCHEMA, { designation: 'warehouse' }, CTX);
    expect(errors).toEqual([
      { field: 'designation', message: 'Must be one of: molding, finishing' },
    ]);
  });

  it('empty values pass membership — presence stays the required check\'s job', () => {
    expect(validateResolverForm(SCHEMA, { designation: '' }, CTX)).toEqual([]);
  });

  it('an unresolvable path leaves the field unconstrained', () => {
    const schema = {
      properties: { pick: { type: 'string', 'x-lt-options': 'envelope.missing' } },
    };
    expect(validateResolverForm(schema, { pick: 'anything' }, CTX)).toEqual([]);
  });

  it('the API entry point enforces the same membership against the row context', () => {
    expect(validateResolverPayload(SCHEMA, { left_quantity: 3 }, CTX)).toEqual([]);
    expect(validateResolverPayload(SCHEMA, { left_quantity: 9 }, CTX)).toHaveLength(1);
  });
});
