import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import type { Server } from 'http';
import type { AddressInfo } from 'net';

const bot = vi.hoisted(() => ({ userId: '' }));
vi.mock('../../services/auth/bot-api-key', () => ({
  validateBotApiKey: vi.fn(async (key: string) => (key === 'lt_bot_probe' ? { user_id: bot.userId, scopes: ['mcp:full'] } : null)),
}));

import { migrate } from '../../lib/db/migrate';
import { createApp, jsonBody } from '../../lib/http';
import routes from '../../routes';
import { config } from '../../modules/config';
import { signToken } from '../../modules/auth';
import { setOAuthServerConfig, clearOAuthServerConfig } from '../../modules/oauth-server';
import { exchangeAuthorizationCode } from '../../services/auth/oauth-server';
import { REDIRECT_URI, pkcePair, createGrantFixture, removeGrantFixture } from '../helpers/oauth-server-fixtures';

const STAMP = `${Date.now()}-authorize`;
const ISSUER = 'http://lt.example';
let server: Server;
let base: string;
let fixture: { userId: string; clientId: string };
let session: string;
let savedSecret: string;
const pkce = pkcePair();

const request = (overrides: Record<string, string | undefined> = {}) => ({
  response_type: 'code', client_id: fixture.clientId, redirect_uri: REDIRECT_URI,
  code_challenge: pkce.challenge, code_challenge_method: 'S256', state: 'st-1', ...overrides,
});

async function authorizeGet(params: Record<string, string | undefined>) {
  const query = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined) as [string, string][]);
  const res = await fetch(`${base}/authorize?${query}`, { redirect: 'manual' });
  return { status: res.status, location: res.headers.get('location'), body: res.status === 302 ? null : await res.json() };
}

async function post(path: string, body: unknown, token: string | null = session) {
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

beforeAll(async () => {
  await migrate();
  savedSecret = config.JWT_SECRET;
  (config as any).JWT_SECRET = 'authorize-secret';
  fixture = await createGrantFixture(STAMP, `oauth-authorize-${STAMP}`);
  bot.userId = fixture.userId;
  session = signToken({ userId: fixture.userId, role: 'member' });
  setOAuthServerConfig({ issuer: ISSUER });
  const app = createApp();
  app.use(jsonBody());
  app.use('/api', routes);
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/oauth`;
}, 30_000);

afterAll(async () => {
  clearOAuthServerConfig();
  (config as any).JWT_SECRET = savedSecret;
  await removeGrantFixture(fixture);
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('GET /api/oauth/authorize', () => {
  it('never redirects for an unknown client or unregistered redirect URI', async () => {
    expect(await authorizeGet(request({ client_id: 'ltc_unknown' }))).toMatchObject({ status: 400, location: null, body: { error: 'invalid_client' } });
    expect(await authorizeGet(request({ redirect_uri: 'http://127.0.0.1:1/elsewhere' }))).toMatchObject({ status: 400, location: null });
  });

  it('reports other errors to the client with state and iss', async () => {
    const cases: Array<[Record<string, string | undefined>, string]> = [
      [{ response_type: 'token' }, 'unsupported_response_type'],
      [{ code_challenge: undefined }, 'invalid_request'],
      [{ code_challenge_method: 'plain' }, 'invalid_request'],
      [{ resource: 'http://other.example/mcp' }, 'invalid_target'],
    ];
    for (const [overrides, error] of cases) {
      const reply = await authorizeGet(request(overrides));
      const location = new URL(reply.location!);
      expect(reply.status).toBe(302);
      expect(`${location.origin}${location.pathname}`).toBe(REDIRECT_URI);
      expect(Object.fromEntries(location.searchParams)).toMatchObject({ error, state: 'st-1', iss: ISSUER });
    }
  });

  it('sends a valid request to the consent page', async () => {
    const reply = await authorizeGet(request({ resource: `${ISSUER}/mcp`, scope: 'mcp:read' }));
    const location = new URL(reply.location!);
    expect(`${location.origin}${location.pathname}`).toBe(`${ISSUER}/oauth/consent`);
    expect(Object.fromEntries(location.searchParams)).toMatchObject({
      client_id: fixture.clientId, redirect_uri: REDIRECT_URI, code_challenge: pkce.challenge, state: 'st-1', resource: `${ISSUER}/mcp`,
    });
  });
});

describe('POST /api/oauth/authorize and /deny', () => {
  it('approving returns a redirect whose code exchanges for the chosen grant', async () => {
    const reply = await post('/authorize', { ...request(), preset: 'read_only' });
    const location = new URL(reply.body.redirect);
    expect(location.searchParams.get('state')).toBe('st-1');
    expect(location.searchParams.get('iss')).toBe(ISSUER);
    const exchanged = await exchangeAuthorizationCode({
      code: location.searchParams.get('code')!, codeVerifier: pkce.verifier, clientId: fixture.clientId,
      redirectUri: REDIRECT_URI, refreshTtlSeconds: 60,
    });
    expect(exchanged?.snapshot).toMatchObject({ user_id: fixture.userId, policy: { preset: 'read_only' }, scope: 'mcp:read' });
    expect(exchanged?.resource).toBe(`${ISSUER}/mcp`);
  });

  it('needs a person\'s session: none gets 401, a bot key gets 403', async () => {
    expect((await post('/authorize', { ...request(), preset: 'just_me' }, null)).status).toBe(401);
    expect((await post('/authorize', { ...request(), preset: 'just_me' }, 'lt_bot_probe')).status).toBe(403);
  });

  it('re-validates the request and the preset', async () => {
    expect((await post('/authorize', { ...request({ redirect_uri: 'http://127.0.0.1:1/x' }), preset: 'read_only' })).status).toBe(400);
    expect((await post('/authorize', { ...request(), preset: 'superuser' })).status).toBe(400);
  });

  it('denying returns a redirect with access_denied', async () => {
    const reply = await post('/deny', { client_id: fixture.clientId, redirect_uri: REDIRECT_URI, state: 'st-2' });
    expect(Object.fromEntries(new URL(reply.body.redirect).searchParams)).toEqual({ error: 'access_denied', state: 'st-2', iss: ISSUER });
    expect((await post('/deny', { client_id: fixture.clientId, redirect_uri: 'http://127.0.0.1:1/x' })).status).toBe(400);
  });
});

describe('GET /api/oauth/clients/:id', () => {
  it('shows the client to a signed-in person only', async () => {
    const get = (id: string, token: string | null) =>
      fetch(`${base}/clients/${id}`, { headers: token ? { authorization: `Bearer ${token}` } : {} });
    expect(await (await get(fixture.clientId, session)).json()).toMatchObject({ client_id: fixture.clientId, client_name: 'fixture' });
    expect((await get('ltc_unknown', session)).status).toBe(404);
    expect((await get(fixture.clientId, null)).status).toBe(401);
  });
});
