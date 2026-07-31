import { describe, it, expect } from 'vitest';
import { readSubmitOnClaim } from '../../../../shared/form-validation/x-lt-submit-on-claim';

describe('readSubmitOnClaim', () => {
  it('returns false when the schema does not opt in', () => {
    expect(readSubmitOnClaim(null)).toBe(false);
    expect(readSubmitOnClaim(undefined)).toBe(false);
    expect(readSubmitOnClaim({})).toBe(false);
    expect(readSubmitOnClaim({ 'x-lt-submit-on-claim': false })).toBe(false);
  });

  it('returns true when opted in', () => {
    expect(readSubmitOnClaim({ 'x-lt-submit-on-claim': true })).toBe(true);
  });

  it('coerces a truthy non-boolean to true', () => {
    expect(readSubmitOnClaim({ 'x-lt-submit-on-claim': 'yes' as unknown as boolean })).toBe(true);
  });
});
