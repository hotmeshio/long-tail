import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { migrate } from '../../../lib/db/migrate';
import { getPool } from '../../../lib/db';
import {
  createAnnouncement,
  listActiveAnnouncements,
  deleteAnnouncement,
} from '../../../services/announcement';

// Announcements — liberal defaults (only body required, 24h expiry), display
// scoping by role overlap, expiry filtering, and hard delete.

const MARK = `ann-test-${Date.now()}`;

describe('announcement service', () => {
  beforeAll(async () => {
    await migrate();
  }, 30_000);

  afterAll(async () => {
    await getPool().query('DELETE FROM lt_announcements WHERE body LIKE $1', [`${MARK}%`]);
  });

  it('creates with only a body — layout, targeting, and 24h expiry default', async () => {
    const a = await createAnnouncement({ body: `${MARK} maintenance tonight` });
    expect(a.layout).toBe('banner');
    expect(a.roles).toEqual([]);
    expect(a.title).toBeNull();
    const hours = (new Date(a.expires_at).getTime() - new Date(a.created_at).getTime()) / 3_600_000;
    expect(hours).toBeCloseTo(24, 1);
  });

  it('targeting: untargeted reaches everyone; targeted needs a role overlap', async () => {
    await createAnnouncement({ body: `${MARK} targeted`, roles: ['line-a'] });

    const lineA = await listActiveAnnouncements(['line-a', 'other']);
    expect(lineA.some((a) => a.body === `${MARK} targeted`)).toBe(true);
    expect(lineA.some((a) => a.body === `${MARK} maintenance tonight`)).toBe(true);

    const lineB = await listActiveAnnouncements(['line-b']);
    expect(lineB.some((a) => a.body === `${MARK} targeted`)).toBe(false);
    expect(lineB.some((a) => a.body === `${MARK} maintenance tonight`)).toBe(true);

    // The unscoped admin view sees everything.
    const admin = await listActiveAnnouncements(null);
    expect(admin.some((a) => a.body === `${MARK} targeted`)).toBe(true);
  });

  it('expired announcements drop from every view', async () => {
    await createAnnouncement({
      body: `${MARK} already over`,
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    });
    const rows = await listActiveAnnouncements(null);
    expect(rows.some((a) => a.body === `${MARK} already over`)).toBe(false);
  });

  it('delete returns the removed row (for the removal event), then null', async () => {
    const a = await createAnnouncement({ body: `${MARK} short lived` });
    const deleted = await deleteAnnouncement(a.id);
    expect(deleted?.id).toBe(a.id);
    expect(await deleteAnnouncement(a.id)).toBeNull();
  });
});
