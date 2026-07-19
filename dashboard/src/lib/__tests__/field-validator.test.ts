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
