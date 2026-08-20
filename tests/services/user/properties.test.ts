import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client as Postgres } from 'pg';
import { Durable } from '@hotmeshio/hotmesh';

import { postgres_options } from '../../setup';
import { migrate } from '../../../lib/db/migrate';
import * as userService from '../../../services/user';

const { Connection } = Durable;

// ─────────────────────────────────────────────────────────────────────────────
// User properties — against real Postgres.
//
// Contract: ONE atomic statement per patch — never read-merge-write. Deleting
// is explicit (`remove`); an absent key is kept; `rename` preserves the value
// with no key-absent window. Identity-binding keys (enabled identity scan
// schemes' target facets) assert uniqueness among ACTIVE users in the same
// statement.
// ─────────────────────────────────────────────────────────────────────────────

describe('user properties patch', () => {
  let userId: string;
  let otherId: string;
  const created: string[] = [];

  async function mkUser(metadata?: Record<string, unknown>, status?: 'active' | 'inactive') {
    const user = await userService.createUser({
      external_id: `props-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      display_name: 'Props Tester',
      metadata: metadata as Record<string, any> | undefined,
      ...(status ? { status } : {}),
    });
    created.push(user.id);
    return user;
  }

  beforeAll(async () => {
    await Connection.connect({ class: Postgres, options: postgres_options });
    await migrate();
    userId = (await mkUser({ badge_id: 'B-1001', shift: 'day' })).id;
    otherId = (await mkUser({ badge_id: 'B-2002' })).id;
  }, 60_000);

  afterAll(async () => {
    for (const id of created) await userService.deleteUser(id);
  });

  it('setting one property never clobbers its siblings', async () => {
    const user = await userService.patchUserProperties(userId, {
      set: { badgeSlug: 'gluer-june' },
    });
    expect(user?.metadata).toMatchObject({
      badge_id: 'B-1001',
      shift: 'day',
      badgeSlug: 'gluer-june',
    });
  });

  it('typed values round-trip — number, boolean, object', async () => {
    const user = await userService.patchUserProperties(userId, {
      set: { max_stations: 3, certified: true, prefs: { lane: 'A' } },
    });
    expect(user?.metadata?.max_stations).toBe(3);
    expect(user?.metadata?.certified).toBe(true);
    expect(user?.metadata?.prefs).toEqual({ lane: 'A' });
  });

  it('remove deletes exactly the named key — absence means keep', async () => {
    const user = await userService.patchUserProperties(userId, {
      remove: ['prefs'],
    });
    expect(user?.metadata?.prefs).toBeUndefined();
    expect(user?.metadata?.badge_id).toBe('B-1001');
    expect(user?.metadata?.certified).toBe(true);
  });

  it('rename preserves the value atomically — old gone, new present, siblings untouched', async () => {
    const user = await userService.patchUserProperties(userId, {
      rename: { badgeSlug: 'badge_slug' },
    });
    expect(user?.metadata?.badgeSlug).toBeUndefined();
    expect(user?.metadata?.badge_slug).toBe('gluer-june');
    expect(user?.metadata?.shift).toBe('day');
  });

  it('renaming a missing key is a no-op, not an error', async () => {
    const user = await userService.patchUserProperties(userId, {
      rename: { ghost: 'phantom' },
    });
    expect(user?.metadata?.phantom).toBeUndefined();
  });

  it('set + remove + rename compose in one patch; set wins over rename on collision', async () => {
    const user = await userService.patchUserProperties(userId, {
      set: { shift: 'night', badge_slug: 'gluer-6' },
      remove: ['certified'],
      rename: { badge_slug: 'slug' },
    });
    expect(user?.metadata?.shift).toBe('night');
    expect(user?.metadata?.certified).toBeUndefined();
    // rename moved the OLD value to `slug`; set re-created badge_slug — both by contract.
    expect(user?.metadata?.slug).toBe('gluer-june');
    expect(user?.metadata?.badge_slug).toBe('gluer-6');
  });

  it('a null-metadata user patches from an empty dictionary', async () => {
    const fresh = await mkUser();
    const user = await userService.patchUserProperties(fresh.id, { set: { shift: 'swing' } });
    expect(user?.metadata).toMatchObject({ shift: 'swing' });
  });

  it('answers null for an unknown user', async () => {
    expect(await userService.patchUserProperties('00000000-0000-0000-0000-000000000000', {
      set: { shift: 'day' },
    })).toBeNull();
  });

  it('rejects malformed patches before any write', async () => {
    await expect(userService.patchUserProperties(userId, {})).rejects.toMatchObject({ status: 400 });
    await expect(userService.patchUserProperties(userId, { set: { '': 'x' } })).rejects.toMatchObject({ status: 400 });
    await expect(userService.patchUserProperties(userId, { set: { a: 1 }, remove: ['a'] })).rejects.toMatchObject({ status: 400 });
    await expect(userService.patchUserProperties(userId, { rename: { a: 'a' } })).rejects.toMatchObject({ status: 400 });
    await expect(userService.patchUserProperties(userId, { rename: { a: 'c', b: 'c' } })).rejects.toMatchObject({ status: 400 });
  });

  describe('identity-binding guard (badge scheme facets)', () => {
    beforeAll(async () => {
      // The seeded badge scheme names lt_users.metadata.badge_id; ensure one
      // enabled identity scheme exists so badge_id is guarded.
      const keys = await userService.getIdentityPropertyKeys();
      if (!keys.includes('badge_id')) {
        // Environments without the seeded scheme exercise nothing here.
        console.warn('no identity scheme targeting badge_id — guard tests will be vacuous');
      }
    });

    it('rejects binding a badge value already carried by another ACTIVE user', async () => {
      const keys = await userService.getIdentityPropertyKeys();
      if (!keys.includes('badge_id')) return;
      await expect(
        userService.patchUserProperties(userId, { set: { badge_id: 'B-2002' } }),
      ).rejects.toMatchObject({ status: 409 });
      // The row was not touched.
      const user = await userService.getUser(userId);
      expect(user?.metadata?.badge_id).toBe('B-1001');
    });

    it('re-setting a user\'s OWN badge value passes; an inactive holder does not block', async () => {
      const keys = await userService.getIdentityPropertyKeys();
      if (!keys.includes('badge_id')) return;
      const own = await userService.patchUserProperties(userId, { set: { badge_id: 'B-1001' } });
      expect(own?.metadata?.badge_id).toBe('B-1001');

      await userService.updateUser(otherId, { status: 'inactive' });
      const taken = await userService.patchUserProperties(userId, { set: { badge_id: 'B-2002' } });
      expect(taken?.metadata?.badge_id).toBe('B-2002');
      // Restore for other assertions.
      await userService.patchUserProperties(userId, { set: { badge_id: 'B-1001' } });
      await userService.updateUser(otherId, { status: 'active' });
    });

    it('identity values must be scalar', async () => {
      const keys = await userService.getIdentityPropertyKeys();
      if (!keys.includes('badge_id')) return;
      await expect(
        userService.patchUserProperties(userId, { set: { badge_id: { nested: true } } }),
      ).rejects.toMatchObject({ status: 400 });
    });
  });
});
