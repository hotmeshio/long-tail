import { describe, it, expect } from 'vitest';

import { restrictScopeRoles } from '../../api/escalations/metadata';

// The scan step's expected-queue guard and the caller's write scope fold
// into ONE role filter that rides the atomic SQL. The intersection is the
// fail-closed contract: an empty result matches nothing — never a widened
// filter, never a bypassed guard.
describe('restrictScopeRoles', () => {
  it('global caller with no restriction stays unfiltered (null)', () => {
    expect(restrictScopeRoles([], true, undefined)).toBeNull();
    expect(restrictScopeRoles([], true, [])).toBeNull();
  });

  it('global caller with a restriction is bounded by the restriction', () => {
    expect(restrictScopeRoles([], true, ['queue-a'])).toEqual(['queue-a']);
  });

  it('scoped caller with no restriction keeps their scope roles', () => {
    expect(restrictScopeRoles(['queue-a', 'queue-b'], false, undefined))
      .toEqual(['queue-a', 'queue-b']);
  });

  it('scoped caller intersects scope with the restriction', () => {
    expect(restrictScopeRoles(['queue-a', 'queue-b'], false, ['queue-b', 'queue-c']))
      .toEqual(['queue-b']);
  });

  it('an empty intersection returns [] — matches nothing, never widens', () => {
    expect(restrictScopeRoles(['queue-a'], false, ['queue-z'])).toEqual([]);
  });
});
