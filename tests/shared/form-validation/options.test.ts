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
    reasons: [
      { value: 'uuid-1', label: 'Delamination' },
      { id: 'uuid-2', label: 'Warping' },
    ],
  },
};

describe('x-lt-options resolution', () => {
  it('resolves a scalar array from the context path — a scalar is both value and label', () => {
    expect(resolveFieldOptions({ 'x-lt-options': 'envelope.left_quantity_options' }, CTX))
      .toEqual([
        { value: 0, label: '0' }, { value: 1, label: '1' },
        { value: 2, label: '2' }, { value: 3, label: '3' },
      ]);
    expect(resolveFieldOptions({ 'x-lt-options': 'envelope.nested.deep' }, CTX))
      .toEqual([{ value: 'a', label: 'a' }, { value: 'b', label: 'b' }]);
  });

  it('resolves { value, label } objects — id accepted as the value alias', () => {
    expect(resolveFieldOptions({ 'x-lt-options': 'envelope.reasons' }, CTX)).toEqual([
      { value: 'uuid-1', label: 'Delamination' },
      { value: 'uuid-2', label: 'Warping' },
    ]);
  });

  it('a static enum takes precedence over the dynamic path', () => {
    const fieldSchema = { enum: ['x', 'y'], 'x-lt-options': 'envelope.return_stations' };
    expect(resolveFieldOptions(fieldSchema, CTX)).toEqual([
      { value: 'x', label: 'x' }, { value: 'y', label: 'y' },
    ]);
  });

  it('unresolvable paths, empty arrays, and non-arrays yield no options', () => {
    expect(resolveFieldOptions({ 'x-lt-options': 'envelope.missing' }, CTX)).toBeUndefined();
    expect(resolveFieldOptions({ 'x-lt-options': 'envelope.empty' }, CTX)).toBeUndefined();
    expect(resolveFieldOptions({ 'x-lt-options': 'envelope.not_an_array' }, CTX)).toBeUndefined();
    expect(resolveFieldOptions({ 'x-lt-options': 'no-dot' }, CTX)).toBeUndefined();
    expect(resolveFieldOptions({ 'x-lt-options': 'ghost.path' }, CTX)).toBeUndefined();
    expect(resolveFieldOptions({ 'x-lt-options': 'envelope.left_quantity_options' }, undefined)).toBeUndefined();
  });

  it('a mixed array resolves each entry independently, dropping malformed ones', () => {
    // { id: 3 } lacks a label; null and nested arrays are never options.
    expect(resolveFieldOptions({ 'x-lt-options': 'envelope.mixed' }, CTX)).toEqual([
      { value: 1, label: '1' }, { value: 'two', label: 'two' },
    ]);
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

  it('object options enforce membership on the VALUE — labels are presentation', () => {
    const schema = {
      properties: { reason: { type: 'string', 'x-lt-options': 'envelope.reasons' } },
    } as Record<string, unknown>;
    expect(validateResolverForm(schema, { reason: 'uuid-2' }, CTX)).toEqual([]);
    // The displayed label is NOT a legal answer; the violation names the values.
    expect(validateResolverForm(schema, { reason: 'Warping' }, CTX)).toEqual([
      { field: 'reason', message: 'Must be one of: uuid-1, uuid-2' },
    ]);
  });

  it('the API entry point enforces the same membership against the row context', () => {
    expect(validateResolverPayload(SCHEMA, { left_quantity: 3 }, CTX)).toEqual([]);
    expect(validateResolverPayload(SCHEMA, { left_quantity: 9 }, CTX)).toHaveLength(1);
  });
});

describe('x-lt-options cascading (interpolated paths)', () => {
  // The lookup domain rides the ctx like any other; the region select's
  // options follow the live country answer.
  const LOOKUP_CTX = {
    lookup: {
      geo: {
        countries: ['US', 'EU'],
        regions: { US: ['CA', 'NY'], EU: ['DE', 'FR'] },
      },
    },
  };
  const CASCADE_SCHEMA = {
    properties: {
      country: { type: 'string', 'x-lt-options': 'lookup.geo.countries' },
      region: { type: 'string', title: 'Region', 'x-lt-options': 'lookup.geo.regions.{{resolver.country}}' },
    },
  } as Record<string, unknown>;

  it('a child value legal for the chosen parent passes; another parent\'s value fails', () => {
    expect(validateResolverForm(CASCADE_SCHEMA, { country: 'US', region: 'NY' }, LOOKUP_CTX)).toEqual([]);
    const errors = validateResolverForm(CASCADE_SCHEMA, { country: 'US', region: 'DE' }, LOOKUP_CTX);
    expect(errors).toEqual([
      { field: 'region', message: 'Must be one of: CA, NY' },
    ]);
  });

  it('fails closed: a child value with no parent answer never submits', () => {
    const errors = validateResolverForm(CASCADE_SCHEMA, { country: '', region: 'CA' }, LOOKUP_CTX);
    expect(errors).toEqual([
      { field: 'region', message: 'No valid options for this selection' },
    ]);
  });

  it('an interpolated path yields [] on miss; a plain path keeps the legacy undefined', () => {
    expect(resolveFieldOptions(
      { 'x-lt-options': 'lookup.geo.regions.{{resolver.country}}' },
      { ...LOOKUP_CTX, resolver: {} },
    )).toEqual([]);
    expect(resolveFieldOptions({ 'x-lt-options': 'lookup.geo.absent' }, LOOKUP_CTX)).toBeUndefined();
  });

  it('the API entry point enforces the cascade against the submitted values', () => {
    expect(validateResolverPayload(CASCADE_SCHEMA, { country: 'EU', region: 'FR' }, LOOKUP_CTX)).toEqual([]);
    expect(validateResolverPayload(CASCADE_SCHEMA, { country: 'EU', region: 'CA' }, LOOKUP_CTX)).toHaveLength(1);
  });
});

describe('x-lt-options ordered sources (first-resolvable-wins)', () => {
  // One shared schema; two kinds of rows. The lookup-backed row resolves the
  // ref; the parked pre-migration row falls through to its embedded envelope.
  const FIELD = {
    'x-lt-options': ['lookup.reasons.items', 'envelope.reject_reason_items'],
  } as Record<string, unknown>;
  const LOOKUP_ROW = {
    lookup: { reasons: { items: [{ value: 'uuid-1', label: 'Delamination' }] } },
    envelope: { reject_reason_items: ['stale-a', 'stale-b'] },
  };
  const PARKED_ROW = {
    envelope: { reject_reason_items: ['scratch', 'dent'] },
  };

  it('the first entry that resolves wins — the ref-backed row never reads the envelope', () => {
    expect(resolveFieldOptions(FIELD, LOOKUP_ROW)).toEqual([
      { value: 'uuid-1', label: 'Delamination' },
    ]);
  });

  it('a parked row with no ref falls through to its embedded envelope list', () => {
    expect(resolveFieldOptions(FIELD, PARKED_ROW)).toEqual([
      { value: 'scratch', label: 'scratch' },
      { value: 'dent', label: 'dent' },
    ]);
  });

  it('all-plain-path misses keep the legacy free-input reading (undefined, unenforced)', () => {
    expect(resolveFieldOptions(FIELD, { envelope: {} })).toBeUndefined();
    const schema = { properties: { reason: { type: 'string', ...FIELD } } };
    expect(validateResolverForm(schema, { reason: 'anything' }, { envelope: {} })).toEqual([]);
  });

  it('an interpolated entry keeps the fail-closed contract when nothing resolves', () => {
    const cascade = {
      'x-lt-options': [
        'lookup.geo.regions.{{resolver.country}}',
        'envelope.geo.regions.{{resolver.country}}',
      ],
    };
    expect(resolveFieldOptions(cascade, { resolver: {} })).toEqual([]);
  });

  it('cascades resolve per entry against whichever domain the row carries', () => {
    const cascade = {
      'x-lt-options': [
        'lookup.geo.regions.{{resolver.country}}',
        'envelope.geo.regions.{{resolver.country}}',
      ],
    };
    const parked = {
      envelope: { geo: { regions: { US: ['CA', 'NY'] } } },
      resolver: { country: 'US' },
    };
    expect(resolveFieldOptions(cascade, parked)).toEqual([
      { value: 'CA', label: 'CA' }, { value: 'NY', label: 'NY' },
    ]);
  });

  it('enforcement validates against the source that won, on both entry points', () => {
    const schema = {
      properties: { reason: { type: 'string', ...FIELD } },
    } as Record<string, unknown>;
    // Parked row: the envelope set is the contract.
    expect(validateResolverForm(schema, { reason: 'dent' }, PARKED_ROW)).toEqual([]);
    expect(validateResolverPayload(schema, { reason: 'uuid-1' }, PARKED_ROW)).toEqual([
      { field: 'reason', message: 'Must be one of: scratch, dent' },
    ]);
    // Lookup row: the edition is the contract — the stale envelope list is unreachable.
    expect(validateResolverPayload(schema, { reason: 'uuid-1' }, LOOKUP_ROW)).toEqual([]);
    expect(validateResolverPayload(schema, { reason: 'stale-a' }, LOOKUP_ROW)).toHaveLength(1);
  });

  it('malformed entries drop; an all-malformed array reads as no token', () => {
    expect(resolveFieldOptions({ 'x-lt-options': [42, null] } as any, PARKED_ROW)).toBeUndefined();
    expect(resolveFieldOptions(
      { 'x-lt-options': [42, 'envelope.reject_reason_items'] } as any, PARKED_ROW,
    )).toHaveLength(2);
  });
});
