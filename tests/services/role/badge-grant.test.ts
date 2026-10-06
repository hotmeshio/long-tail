import { describe, it, expect } from 'vitest';

import { badgeGrantError, readBadgeGrant } from '../../../services/role/badge-grant';
import { applyRoleConfig } from '../../../services/role/seed';

describe('properties.badge_grant', () => {
  it('accepts a full or partial policy, and its absence', () => {
    expect(badgeGrantError({ ttl_seconds: 600, max_uses: 0, scope: 'action' })).toBeNull();
    expect(badgeGrantError({ max_uses: 1 })).toBeNull();
    expect(badgeGrantError(undefined)).toBeNull();
  });

  it('names what is wrong', () => {
    expect(badgeGrantError([])).toMatch(/must be an object/);
    expect(badgeGrantError({ ttl_seconds: 0 })).toMatch(/ttl_seconds/);
    expect(badgeGrantError({ ttl_seconds: 90_000 })).toMatch(/ttl_seconds/);
    expect(badgeGrantError({ max_uses: -1 })).toMatch(/max_uses/);
    expect(badgeGrantError({ scope: 'forever' })).toMatch(/scope/);
    expect(badgeGrantError({ ttl: 600 })).toMatch(/unknown key/);
  });

  it('reads a usable policy and ignores an unusable one', () => {
    expect(readBadgeGrant({ badge_grant: { ttl_seconds: 600 }, kiosk: true })).toEqual({ ttl_seconds: 600 });
    expect(readBadgeGrant({ badge_grant: { ttl_seconds: -5 } })).toBeNull();
    expect(readBadgeGrant({ kiosk: true })).toBeNull();
    expect(readBadgeGrant(null)).toBeNull();
  });

  it('a code-owned role declaring an unusable policy fails its apply, before any write', async () => {
    await expect(applyRoleConfig({ role: 'never-written', properties: { badge_grant: { max_uses: -1 } } }, true))
      .rejects.toThrow(/role never-written: properties.badge_grant.max_uses/);
  });
});
