import { describe, it, expect } from 'vitest';

import { isSystemTierRole, SYSTEM_TIER_ROLES } from '../task-queues';

describe('isSystemTierRole', () => {
  it('classifies every capability tier as a system role', () => {
    for (const tier of SYSTEM_TIER_ROLES) {
      expect(isSystemTierRole(tier)).toBe(true);
    }
  });

  it('treats work-lane roles as non-system', () => {
    expect(isSystemTierRole('printer')).toBe(false);
    expect(isSystemTierRole('intake-reviewer')).toBe(false);
    expect(isSystemTierRole('')).toBe(false);
  });
});
