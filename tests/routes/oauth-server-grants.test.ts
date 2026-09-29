import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import type { Server } from 'http';
import type { AddressInfo } from 'net';

vi.mock('../../services/domain', () => ({ getDomainIndex: vi.fn(async () => null), getDomainDictionary: vi.fn(async () => null) }));

import { migrate } from '../../lib/db/migrate';
import { getPool } from '../../lib/db';
import { createApp, jsonBody } from '../../lib/http';
import routes from '../../routes';
import mcpRouter from '../../routes/mcp-endpoint';
import { config } from '../../modules/config';
import { signToken } from '../../modules/auth';
import * as userService from '../../services/user';
import { setOAuthServerConfig, clearOAuthServerConfig } from '../../modules/oauth-server';
import { exchangeAuthorizationCode, signAccessToken } from '../../services/auth/oauth-server';
import { clearRevocations } from '../../services/auth/oauth-server/revocations';
import { REDIRECT_URI, createGrantFixture, issueCode, removeGrantFixture } from '../helpers/oauth-server-fixtures';

const STAMP = `${Date.now()}-grants`;
let server: Server;
let origin: string;
let fixture: { userId: string; clientId: string };
let readOnlyUserId: string;
let savedSecret: string;

const as = (userId: string) => ({ authorization: `Bearer ${signToken({ userId, role: 'member' })}` });
const api = (path: string, userId: string, init: RequestInit = {}) =>
  fetch(`${origin}/api/oauth${path}`, { ...init, headers: { ...as(userId), ...(init.headers ?? {}) } });

async function activeGrant(): Promise<{ grantId: string; accessToken: string }> {
  const { code, grantId, verifier } = await issueCode(fixture);
  const exchanged = await exchangeAuthorizationCode({
    code, codeVerifier: verifier, clientId: fixture.clientId, redirectUri: REDIRECT_URI, refreshTtlSeconds: 60,
  });
  const accessToken = signAccessToken(exchanged!.snapshot, { issuer: origin, audience: `${origin}/mcp` }).token;
  return { grantId, accessToken };
}

beforeAll(async () => {
  await migrate();
  savedSecret = config.JWT_SECRET;
  (config as any).JWT_SECRET = 'grants-secret';
  fixture = await createGrantFixture(STAMP, `oauth-grants-${STAMP}`);
  readOnlyUserId = (await userService.createUser({
    external_id: `oauth-grants-ro-${STAMP}`,
    roles: [{ role: `oauth-grants-${STAMP}`, type: 'member', read_scope: 'all', write_scope: 'none' } as any],
  })).id;
  const app = createApp();
  app.use(jsonBody());
  app.use('/api', routes);
  app.use('/mcp', mcpRouter);
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  setOAuthServerConfig({ issuer: origin });
}, 30_000);

afterAll(async () => {
  clearOAuthServerConfig();
  clearRevocations();
  (config as any).JWT_SECRET = savedSecret;
  await getPool().query('DELETE FROM lt_users WHERE id = $1', [readOnlyUserId]);
  await removeGrantFixture(fixture);
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('GET /api/oauth/presets', () => {
  it('offers Just be me only to a person who can write somewhere', async () => {
    expect(await (await api('/presets', fixture.userId)).json()).toEqual({ presets: ['read_only', 'just_me'] });
    expect(await (await api('/presets', readOnlyUserId)).json()).toEqual({ presets: ['read_only'] });
  });
});

describe('connected apps', () => {
  it('lists grants a client has put to use, not consents never exchanged', async () => {
    const { grantId } = await activeGrant();
    const unexchanged = await issueCode(fixture);
    const { grants } = await (await api('/grants', fixture.userId)).json();
    const ids = grants.map((g: { grant_id: string }) => g.grant_id);
    expect(ids).toContain(grantId);
    expect(ids).not.toContain(unexchanged.grantId);
    expect(grants.find((g: { grant_id: string }) => g.grant_id === grantId)).toMatchObject({
      client_id: fixture.clientId, client_name: 'fixture', policy: { preset: 'read_only' }, scope: 'mcp:read',
    });
  });

  it('disconnecting stops the app\'s access token at once', async () => {
    const { grantId, accessToken } = await activeGrant();
    const mcp = () => fetch(`${origin}/mcp`, {
      method: 'POST',
      headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    });
    expect((await mcp()).status).toBe(200);
    expect(await (await api(`/grants/${grantId}`, fixture.userId, { method: 'DELETE' })).json()).toEqual({ disconnected: true });
    expect((await mcp()).status).toBe(401);
    const { grants } = await (await api('/grants', fixture.userId)).json();
    expect(grants.map((g: { grant_id: string }) => g.grant_id)).not.toContain(grantId);
  });

  it('a person cannot disconnect someone else\'s app', async () => {
    const { grantId } = await activeGrant();
    expect((await api(`/grants/${grantId}`, readOnlyUserId, { method: 'DELETE' })).status).toBe(404);
    expect((await api('/grants/not-a-uuid', fixture.userId, { method: 'DELETE' })).status).toBe(404);
  });

  it('needs a session', async () => {
    expect((await fetch(`${origin}/api/oauth/grants`)).status).toBe(401);
  });
});
