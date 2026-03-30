import { describe, it, expect } from 'vitest';
import { setupRouteTest, authHeaders } from './setup';

const ctx = setupRouteTest(4611, {
  maintenance: {
    schedule: '0 3 * * *',
    rules: [{ target: 'streams', olderThan: '7 days', action: 'delete' }],
  },
});

describe('Maintenance routes', () => {
  describe('GET /api/config/maintenance', () => {
    it('returns 401 without auth', async () => {
      const res = await fetch(`${ctx.BASE}/config/maintenance`);
      expect(res.status).toBe(401);
    });

    it('returns maintenance config', async () => {
      const res = await fetch(`${ctx.BASE}/config/maintenance`, {
        headers: authHeaders(ctx.memberToken),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.active).toBe(true);
      expect(body.config.schedule).toBe('0 3 * * *');
      expect(Array.isArray(body.config.rules)).toBe(true);
    });
  });

  describe('PUT /api/config/maintenance', () => {
    it('requires admin', async () => {
      const res = await fetch(`${ctx.BASE}/config/maintenance`, {
        method: 'PUT',
        headers: authHeaders(ctx.memberToken),
        body: JSON.stringify({ schedule: '0 5 * * *', rules: [] }),
      });
      expect(res.status).toBe(403);
    });

    it('validates required fields', async () => {
      const res = await fetch(`${ctx.BASE}/config/maintenance`, {
        method: 'PUT',
        headers: authHeaders(ctx.adminToken),
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
      const body = await res.json() as any;
      expect(body.error).toContain('schedule');
    });

    it('updates maintenance config', async () => {
      const newConfig = {
        schedule: '30 2 * * *',
        rules: [{ target: 'streams', olderThan: '3 days', action: 'delete' }],
      };
      const res = await fetch(`${ctx.BASE}/config/maintenance`, {
        method: 'PUT',
        headers: authHeaders(ctx.adminToken),
        body: JSON.stringify(newConfig),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.restarted).toBe(true);
      expect(body.config.schedule).toBe('30 2 * * *');

      // Restore original schedule
      await fetch(`${ctx.BASE}/config/maintenance`, {
        method: 'PUT',
        headers: authHeaders(ctx.adminToken),
        body: JSON.stringify({
          schedule: '0 3 * * *',
          rules: [{ target: 'streams', olderThan: '7 days', action: 'delete' }],
        }),
      });
    });
  });
});
