import { describe, it, expect, afterAll, afterEach } from 'vitest';

import { setupRouteTest } from './setup';
import { setSSOConfig, clearSSOConfig } from '../../modules/sso';
import * as userService from '../../services/user';

const ctx = setupRouteTest(4644);

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/auth/sso — the exchange is the session boundary. resolve receives
// the response handle so a cookie-owning host can slide its own session on
// every beat; the route never double-writes if a host violates the
// headers-only contract.
// ─────────────────────────────────────────────────────────────────────────────

const EXT_ID = 'sso-exchange-res-user';

describe('POST /auth/sso — response handle at the exchange', () => {
  afterEach(() => clearSSOConfig());

  afterAll(async () => {
    const user = await userService.getUserByExternalId(EXT_ID);
    if (user) await userService.deleteUser(user.id);
  });

  it('hands resolve the response so the host can refresh its session cookie', async () => {
    setSSOConfig({
      resolve: (_req, res) => {
        res?.setHeader('set-cookie', 'host_session=refreshed; Path=/; HttpOnly');
        return { externalId: EXT_ID, displayName: 'Exchange User' };
      },
    });

    const res = await fetch(`${ctx.BASE}/auth/sso`, { method: 'POST' });
    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie')).toContain('host_session=refreshed');
    const body = await res.json();
    expect(body.token).toBeTruthy();
    expect(body.user.external_id).toBe(EXT_ID);
  });

  it('never double-writes when a host violates the headers-only contract', async () => {
    setSSOConfig({
      resolve: (_req, res) => {
        // Contract violation: the host writes the response itself.
        (res as any)?.status(418).json({ hostSays: 'teapot' });
        return { externalId: EXT_ID, displayName: 'Exchange User' };
      },
    });

    const res = await fetch(`${ctx.BASE}/auth/sso`, { method: 'POST' });
    // The host's write stands; the route skips its own (no headers-after-send crash).
    expect(res.status).toBe(418);
    expect(await res.json()).toEqual({ hostSays: 'teapot' });
  });

  it('resolve returning null still yields 401', async () => {
    setSSOConfig({ resolve: () => null });
    const res = await fetch(`${ctx.BASE}/auth/sso`, { method: 'POST' });
    expect(res.status).toBe(401);
  });
});
