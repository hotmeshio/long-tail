import { describe, it, expect } from 'vitest';

import { validateField, validateFieldType, validateFieldConstraints } from '../../../shared/form-validation';

// ─────────────────────────────────────────────────────────────────────────────
// Declared-type and enum enforcement — the payload-integrity backstop for
// API-first submitters. A form widget produces the right primitive; a script
// submitting "1" for a number field does not, and must be told so.
// ─────────────────────────────────────────────────────────────────────────────

describe('validateFieldType', () => {
  it('rejects a string where a number is declared', () => {
    expect(validateFieldType('1', { type: 'number' })).toBe('Expected a number');
    expect(validateFieldType(1, { type: 'number' })).toBeUndefined();
  });

  it('rejects a float where an integer is declared', () => {
    expect(validateFieldType(1.5, { type: 'integer' })).toBe('Expected a whole number');
    expect(validateFieldType('2', { type: 'integer' })).toBe('Expected a whole number');
    expect(validateFieldType(2, { type: 'integer' })).toBeUndefined();
  });

  it('rejects non-boolean where a boolean is declared', () => {
    expect(validateFieldType('true', { type: 'boolean' })).toBe('Expected true or false');
    expect(validateFieldType(true, { type: 'boolean' })).toBeUndefined();
    expect(validateFieldType(false, { type: 'boolean' })).toBeUndefined();
  });

  it('rejects a number where a string is declared', () => {
    expect(validateFieldType(7, { type: 'string' })).toBe('Expected text');
    expect(validateFieldType('7', { type: 'string' })).toBeUndefined();
  });

  it('distinguishes arrays from objects', () => {
    expect(validateFieldType([], { type: 'object' })).toBe('Expected an object');
    expect(validateFieldType({}, { type: 'array' })).toBe('Expected a list');
    expect(validateFieldType({}, { type: 'object' })).toBeUndefined();
    expect(validateFieldType([], { type: 'array' })).toBeUndefined();
  });

  it('passes absent and empty values — presence is the required check', () => {
    expect(validateFieldType(undefined, { type: 'number' })).toBeUndefined();
    expect(validateFieldType(null, { type: 'number' })).toBeUndefined();
    expect(validateFieldType('', { type: 'number' })).toBeUndefined();
  });

  it('passes when the schema declares no type', () => {
    expect(validateFieldType('anything', {})).toBeUndefined();
    expect(validateFieldType('anything', undefined)).toBeUndefined();
  });
});

describe('enum membership', () => {
  const FIELD = { type: 'string', enum: ['starter', 'professional'] };

  it('rejects values outside the enum', () => {
    expect(validateFieldConstraints('enterprise', FIELD)).toBe('Must be one of: starter, professional');
  });

  it('accepts declared values and absent values', () => {
    expect(validateFieldConstraints('starter', FIELD)).toBeUndefined();
    expect(validateFieldConstraints(undefined, FIELD)).toBeUndefined();
    expect(validateFieldConstraints('', FIELD)).toBeUndefined();
  });
});

describe('validateField ordering', () => {
  it('reports the type error before constraints that would not apply', () => {
    // "5" fails type; the numeric minimum branch would silently skip a string.
    const err = validateField('5', { type: 'number', minimum: 10 }, false, true);
    expect(err).toBe('Expected a number');
  });

  it('reports Required before the type check', () => {
    const err = validateField(undefined, { type: 'number' }, true, true);
    expect(err).toBe('Required');
  });
});
