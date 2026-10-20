import { describe, it, expect } from 'vitest';

import { readSubmitGuard } from '../../../shared/form-validation/x-lt-submit-guard';

describe('readSubmitGuard with a roster', () => {
  it('reads a guard that names a roster field', () => {
    expect(readSubmitGuard({ 'x-lt-submit-guard': { roster: 'orders' } })).toEqual({ roster: 'orders' });
  });

  it('still requires a query when no roster is named', () => {
    expect(readSubmitGuard({ 'x-lt-submit-guard': { roster: '' } })).toBeUndefined();
    expect(readSubmitGuard({ 'x-lt-submit-guard': { message: 'x' } })).toBeUndefined();
  });
});
