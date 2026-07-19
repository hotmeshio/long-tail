import { describe, it, expect } from 'vitest';
import { validateField, validateFieldConstraints } from '../field-validator';

describe('validateFieldConstraints — strings', () => {
  it('passes when value is empty string (required is caller concern)', () => {
    expect(validateFieldConstraints('', { minLength: 3 })).toBeUndefined();
  });

  it('errors when string is shorter than minLength', () => {
    expect(validateFieldConstraints('ab', { minLength: 3 })).toBe('Minimum 3 characters');
  });

  it('passes when string meets minLength', () => {
    expect(validateFieldConstraints('abc', { minLength: 3 })).toBeUndefined();
  });

  it('errors when string exceeds maxLength', () => {
    expect(validateFieldConstraints('toolong', { maxLength: 5 })).toBe('Maximum 5 characters (7 entered)');
  });

  it('passes when string is within maxLength', () => {
    expect(validateFieldConstraints('ok', { maxLength: 5 })).toBeUndefined();
  });

  it('errors when string does not match pattern', () => {
    expect(validateFieldConstraints('abc123', { pattern: '^[A-Z]+$' })).toBe('Invalid format');
  });

  it('uses x-lt-pattern-error as the error label when present', () => {
    expect(
      validateFieldConstraints('bad', {
        pattern: '^[0-9]+$',
        'x-lt-pattern-error': 'Digits only',
      }),
    ).toBe('Digits only');
  });

  it('passes when string matches pattern', () => {
    expect(validateFieldConstraints('ABC', { pattern: '^[A-Z]+$' })).toBeUndefined();
  });

  it('errors on invalid email format', () => {
    expect(validateFieldConstraints('notanemail', { format: 'email' })).toBe(
      'Enter a valid email address',
    );
  });

  it('passes on valid email', () => {
    expect(validateFieldConstraints('a@b.com', { format: 'email' })).toBeUndefined();
  });

  it('errors on invalid URL', () => {
    expect(validateFieldConstraints('not-a-url', { format: 'uri' })).toBe('Enter a valid URL');
  });

  it('passes on valid https URL', () => {
    expect(validateFieldConstraints('https://example.com', { format: 'uri' })).toBeUndefined();
  });
});

describe('validateFieldConstraints — numbers', () => {
  it('errors when number is below minimum', () => {
    expect(validateFieldConstraints(0, { minimum: 1 })).toBe('Minimum value is 1');
  });

  it('passes when number meets minimum', () => {
    expect(validateFieldConstraints(1, { minimum: 1 })).toBeUndefined();
  });

  it('errors when number exceeds maximum', () => {
    expect(validateFieldConstraints(101, { maximum: 100 })).toBe('Maximum value is 100');
  });

  it('passes when number is at maximum', () => {
    expect(validateFieldConstraints(100, { maximum: 100 })).toBeUndefined();
  });

  it('errors on exclusiveMinimum violation', () => {
    expect(validateFieldConstraints(0, { exclusiveMinimum: 0 })).toBe('Must be greater than 0');
  });

  it('errors on exclusiveMaximum violation', () => {
    expect(validateFieldConstraints(100, { exclusiveMaximum: 100 })).toBe('Must be less than 100');
  });
});

describe('validateField — required + constraint composition', () => {
  it('returns undefined when not touched', () => {
    expect(validateField('', undefined, true, false)).toBeUndefined();
  });

  it('returns Required for empty string when required and touched', () => {
    expect(validateField('', undefined, true, true)).toBe('Required');
  });

  it('returns Required for null when required', () => {
    expect(validateField(null, undefined, true, true)).toBe('Required');
  });

  it('returns Required for all-false object (checklist) when required', () => {
    expect(validateField({ a: false, b: false }, undefined, true, true)).toBe('Required');
  });

  it('returns Required for false boolean (unchecked required checkbox)', () => {
    expect(validateField(false, { type: 'boolean' }, true, true)).toBe('Required');
  });

  it('passes for true boolean (checked required checkbox)', () => {
    expect(validateField(true, { type: 'boolean' }, true, true)).toBeUndefined();
  });

  it('passes for false boolean when not required', () => {
    expect(validateField(false, { type: 'boolean' }, false, true)).toBeUndefined();
  });

  it('returns constraint error when non-empty value violates minLength', () => {
    expect(validateField('ab', { minLength: 5 }, false, true)).toBe('Minimum 5 characters');
  });

  it('returns constraint error on required field after passing required check', () => {
    expect(validateField('ab', { minLength: 5 }, true, true)).toBe('Minimum 5 characters');
  });

  it('passes for valid value with constraints', () => {
    expect(validateField('hello', { minLength: 3, maxLength: 10 }, true, true)).toBeUndefined();
  });
});

describe('validateField — x-lt-require-all (checklist completion guard)', () => {
  const schema = {
    type: 'object',
    'x-lt-widget': 'checklist',
    'x-lt-source': 'envelope.checklist_items',
    'x-lt-require-all': true,
  };
  const ctx = (items: unknown) => ({ envelope: { checklist_items: items } });
  const ITEMS = [
    { id: 'doc', label: 'Documentation attached', required: true },
    { id: 'contact', label: 'Contact verified' }, // no required key = mandatory
    { id: 'photos', label: 'Photos present', required: false }, // explicit opt-out
  ];

  it('passes when every mandatory item is checked (opt-out may stay unchecked)', () => {
    const value = { doc: true, contact: true, photos: false };
    expect(validateField(value, schema, true, true, ctx(ITEMS))).toBeUndefined();
  });

  it('blocks with "N of M checks incomplete" when one mandatory item is unchecked', () => {
    const value = { doc: true, contact: false, photos: true };
    expect(validateField(value, schema, true, true, ctx(ITEMS))).toBe('1 of 2 checks incomplete');
  });

  it('counts only mandatory items — all unchecked reads 2 of 2, not 3 of 3', () => {
    const value = { doc: false, contact: false, photos: false };
    expect(validateField(value, schema, false, true, ctx(ITEMS))).toBe('2 of 2 checks incomplete');
  });

  it('an item with no required key at all is mandatory', () => {
    const value = { doc: true, contact: false, photos: false };
    expect(validateField(value, schema, false, true, ctx(ITEMS))).toBe('1 of 2 checks incomplete');
  });

  it('is vacuous when the source resolves to an empty array', () => {
    expect(validateField({}, schema, false, true, ctx([]))).toBeUndefined();
  });

  it('is vacuous when the source path is missing entirely', () => {
    expect(validateField({}, schema, false, true, { envelope: {} })).toBeUndefined();
  });

  it('is vacuous when every item is an explicit opt-out', () => {
    const items = [{ id: 'a', label: 'A', required: false }];
    expect(validateField({}, schema, false, true, ctx(items))).toBeUndefined();
  });

  it('composes with the required array: at-least-one fires first when nothing is checked', () => {
    // Field listed in required AND require-all: empty state fails the
    // at-least-one check (Required); require-all takes over once any is checked.
    const empty = { doc: false, contact: false, photos: false };
    expect(validateField(empty, schema, true, true, ctx(ITEMS))).toBe('Required');
    const partial = { doc: true, contact: false, photos: false };
    expect(validateField(partial, schema, true, true, ctx(ITEMS))).toBe('1 of 2 checks incomplete');
  });

  it('enforces even when the field is NOT in the required array — require-all stands alone', () => {
    const partial = { doc: true, contact: false };
    expect(validateField(partial, schema, false, true, ctx(ITEMS))).toBe('1 of 2 checks incomplete');
  });

  it('does not fire without the keyword or on non-checklist fields', () => {
    const noKeyword = { ...schema, 'x-lt-require-all': undefined };
    expect(validateField({ doc: true }, noKeyword, false, true, ctx(ITEMS))).toBeUndefined();
    const notChecklist = { 'x-lt-require-all': true };
    expect(validateField({ doc: false }, notChecklist, false, true, ctx(ITEMS))).toBeUndefined();
  });

  it('is untouched-silent like every other guard', () => {
    const value = { doc: false, contact: false };
    expect(validateField(value, schema, false, false, ctx(ITEMS))).toBeUndefined();
  });
});
