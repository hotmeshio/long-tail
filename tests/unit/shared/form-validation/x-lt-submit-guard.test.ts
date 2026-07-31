import { describe, it, expect } from 'vitest';
import { readSubmitGuard, guardBlocks } from '../../../../shared/form-validation/x-lt-submit-guard';

const GUARD = {
  'x-lt-submit-guard': {
    query: { role: 'child', assigned: 'me', facets: { walkId: '{{metadata.walkId}}' } },
    message: '{{count}} still open',
    autoResolveWhenEmpty: true,
  },
};

describe('readSubmitGuard', () => {
  it('returns undefined when absent or malformed', () => {
    expect(readSubmitGuard(null)).toBeUndefined();
    expect(readSubmitGuard(undefined)).toBeUndefined();
    expect(readSubmitGuard({})).toBeUndefined();
    expect(readSubmitGuard({ 'x-lt-submit-guard': 'nope' as unknown })).toBeUndefined();
    // A guard with no query has nothing to evaluate.
    expect(readSubmitGuard({ 'x-lt-submit-guard': { message: 'x' } as unknown })).toBeUndefined();
  });

  it('reads the guard, including autoResolveWhenEmpty', () => {
    const g = readSubmitGuard(GUARD);
    expect(g?.query.role).toBe('child');
    expect(g?.query.assigned).toBe('me');
    expect(g?.message).toBe('{{count}} still open');
    expect(g?.autoResolveWhenEmpty).toBe(true);
  });
});

describe('guardBlocks', () => {
  const g = readSubmitGuard(GUARD)!;
  it('blocks while rows remain, clears at zero', () => {
    expect(guardBlocks(3, g)).toBe(true);
    expect(guardBlocks(0, g)).toBe(false);
  });
  it('is inert without a guard', () => {
    expect(guardBlocks(5, undefined)).toBe(false);
  });
  it('respects mustBeEmpty:false', () => {
    expect(guardBlocks(5, { ...g, mustBeEmpty: false })).toBe(false);
  });
});
