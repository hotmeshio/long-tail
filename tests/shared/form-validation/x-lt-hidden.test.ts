import { describe, it, expect } from 'vitest';

import { validateResolverForm } from '../../../shared/form-validation/validate-resolver-payload';
import { isHiddenField } from '../../../shared/form-validation/x-lt-show-if';

const SCHEMA = {
  required: ['type', 'notes'],
  properties: {
    type: { type: 'string', enum: ['release', 'reset'], 'x-lt-hidden': true },
    notes: { type: 'string' },
  },
};

describe('x-lt-hidden', () => {
  it('is read only from a literal true', () => {
    expect(isHiddenField({ 'x-lt-hidden': true })).toBe(true);
    expect(isHiddenField({ 'x-lt-hidden': 'true' })).toBe(false);
    expect(isHiddenField(undefined)).toBe(false);
  });

  it('is never required, even when listed in required', () => {
    expect(validateResolverForm(SCHEMA, { notes: 'ok' })).toEqual([]);
  });

  it('checks a value it carries against its enum', () => {
    expect(validateResolverForm(SCHEMA, { notes: 'ok', type: 'other' })).toEqual([
      { field: 'type', message: expect.any(String) },
    ]);
    expect(validateResolverForm(SCHEMA, { notes: 'ok', type: 'reset' })).toEqual([]);
  });
});
