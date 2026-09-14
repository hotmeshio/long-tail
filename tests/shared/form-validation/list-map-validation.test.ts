import { describe, it, expect } from 'vitest';

import {
  validateField,
  validateResolverForm,
  validateResolverPayload,
  mapFormToPayload,
} from '../../../shared/form-validation';

// Lists and maps: a role list picked from options and a weight map keyed by
// an allowlist. The same rules run in the dashboard and in the API gate.

const ROLE_OPTIONS = [{ value: 'gluer', label: 'Gluer' }, { value: 'finisher', label: 'Finisher' }, { value: 'qa', label: 'QA' }];
const ROLES = { type: 'array', items: { type: 'string' }, 'x-lt-options': ROLE_OPTIONS, minItems: 1, maxItems: 2, 'x-lt-bind': 'floor.roles' };
const WEIGHTS = {
  type: 'object',
  'x-lt-widget': 'json',
  propertyNames: { enum: ['bag', 'plate', 'spool'] },
  additionalProperties: { type: 'number', minimum: 0, maximum: 1 },
  'x-lt-bind': 'deck.mix',
};
const SCHEMA = { required: ['roles'], properties: { roles: ROLES, weights: WEIGHTS } };

const err = (value: unknown, schema: Record<string, unknown>, required = false) =>
  validateField(value, schema, required, true);

describe('list fields', () => {
  it('required means non-empty for a picked or json list; a display-only list is never checked', () => {
    expect(err([], ROLES, true)).toBe('Required');
    expect(err([], ROLES)).toBeUndefined();
    expect(err([], { type: 'array' }, true)).toBeUndefined();
    expect(err(['x', 1], { type: 'array', items: { type: 'string' }, minItems: 3 })).toBeUndefined();
  });

  it('enforces membership per item from the field\'s x-lt-options', () => {
    expect(err(['gluer', 'welder'], ROLES)).toBe('Must be one of: gluer, finisher, qa');
    expect(err(['gluer'], ROLES)).toBeUndefined();
  });

  it('enforces membership from the list field\'s own x-lt-options, failing closed on an interpolated miss', () => {
    const fromCtx = { type: 'array', 'x-lt-options': 'envelope.trays' };
    expect(err(['t1'], fromCtx, false, )).toBeUndefined();
    expect(validateField(['t9'], fromCtx, false, true, { envelope: { trays: ['t1', 't2'] } })).toBe('Must be one of: t1, t2');
    const cascade = { type: 'array', 'x-lt-options': 'envelope.{{resolver.zone}}' };
    expect(validateField(['t1'], cascade, false, true, { resolver: {} })).toBe('No valid options for this selection');
  });

  it('bounds the length with minItems and maxItems', () => {
    expect(err(['gluer', 'finisher', 'qa'], ROLES)).toBe('At most 2 items');
    expect(err(['x'], { type: 'array', 'x-lt-widget': 'json', minItems: 2 })).toBe('At least 2 items');
  });

  it('a json list validates each item against items, including items.enum', () => {
    const json = (items: Record<string, unknown>) => ({ type: 'array', 'x-lt-widget': 'json', items });
    expect(err([1, 'two'], json({ type: 'number' }))).toBe('Item 2: Expected a number');
    expect(err([1, 5], json({ type: 'number', maximum: 3 }))).toBe('Item 2: Maximum value is 3');
    expect(err(['qa', 'welder'], json({ type: 'string', enum: ['gluer', 'qa'] }))).toBe('Item 2: Must be one of: gluer, qa');
  });
});

describe('map fields', () => {
  it('rejects keys outside propertyNames.enum', () => {
    expect(err({ bag: 1, tray: 1 }, WEIGHTS)).toBe('Unknown key "tray". Allowed: bag, plate, spool');
  });

  it('validates every value against additionalProperties with the key as prefix', () => {
    expect(err({ bag: -1 }, WEIGHTS)).toBe('"bag": Minimum value is 0');
    expect(err({ bag: '1' }, WEIGHTS)).toBe('"bag": Expected a number');
    expect(err({ bag: 0.5, plate: 0.5 }, WEIGHTS)).toBeUndefined();
  });

  it('a required map with a zero weight is answered; an all-false checklist is not', () => {
    expect(err({ bag: 0 }, WEIGHTS, true)).toBeUndefined();
    expect(err({}, WEIGHTS, true)).toBe('Required');
    expect(err({ a: false, b: false }, { type: 'object', 'x-lt-widget': 'checklist' }, true)).toBe('Required');
  });

  it('unparseable json editor text is reported as Invalid JSON', () => {
    expect(err('{"bag": ', WEIGHTS)).toBe('Invalid JSON');
  });
});

describe('the gate sees what the form sees', () => {
  it('a bound list and map validate identically through mapFormToPayload', () => {
    const form = { roles: ['gluer', 'welder'], weights: { bag: 2 } };
    const client = validateResolverForm(SCHEMA, form);
    const server = validateResolverPayload(SCHEMA, mapFormToPayload(form, SCHEMA));
    expect(server).toEqual(client);
    expect(client.map((e) => e.field)).toEqual(['roles', 'weights']);
    expect(validateResolverPayload(SCHEMA, { floor: { roles: ['qa'] }, deck: { mix: { spool: 1 } } })).toEqual([]);
  });
});
