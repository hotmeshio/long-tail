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
import { setOAuthServerConfig, clearOAuthServerConfig } from '../../modules/oauth-server';
import { REDIRECT_URI, pkcePair, createGrantFixture, removeGrantFixture } from '../helpers/oauth-server-fixtures';

// The whole flow over HTTP: consent, code exchange, /mcp, refresh, revoke.

const STAMP = `${Date.now()}-token`;
let server: Server;
let origin: string;
let fixture: { userId: string; clientId: string };
let session: string;
let savedSecret: string;

const form = (fields: Record<string, string>) => new URLSearchParams(fields).toString();

async function tokenRequest(fields: Record<string, string>, asJson = false) {
  const res = await fetch(`${origin}/api/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': asJson ? 'application/json' : 'application/x-www-form-urlencoded' },
    body: asJson ? JSON.stringify(fields) : form(fields),
  });
  return { status: res.status, cacheControl: res.headers.get('cache-control'), body: await res.json() };
}

async function approve(): Promise<{ code: string; verifier: string }> {
  const pkce = pkcePair();
  const res = await fetch(`${origin}/api/oauth/authorize`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${session}` },
    body: JSON.stringify({
      response_type: 'code', client_id: fixture.clientId, redirect_uri: REDIRECT_URI,
      code_challenge: pkce.challenge, code_challenge_method: 'S256', preset: 'just_me',
    }),
  });
  return { code: new URL((await res.json()).redirect).searchParams.get('code')!, verifier: pkce.verifier };
}

async function exchange() {
  const { code, verifier } = await approve();
  return tokenRequest({ grant_type: 'authorization_code', code, code_verifier: verifier, client_id: fixture.clientId, redirect_uri: REDIRECT_URI });
}

const mcpStatus = async (accessToken: string) => (await fetch(`${origin}/mcp`, {
  method: 'POST',
  headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
})).status;

beforeAll(async () => {
  await migrate();
  savedSecret = config.JWT_SECRET;
  (config as any).JWT_SECRET = 'token-endpoint-secret';
  fixture = await createGrantFixture(STAMP, `oauth-token-${STAMP}`);
  session = signToken({ userId: fixture.userId, role: 'member' });
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
  (config as any).JWT_SECRET = savedSecret;
  await removeGrantFixture(fixture);
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('POST /api/oauth/token', () => {
  it('exchanges a code for tokens that work at /mcp and nowhere else', async () => {
    const reply = await exchange();
    expect(reply.status).toBe(200);
    expect(reply.cacheControl).toBe('no-store');
    expect(reply.body).toMatchObject({ token_type: 'Bearer', expires_in: 300, scope: 'mcp:full' });
    expect(await mcpStatus(reply.body.access_token)).toBe(200);
    const api = await fetch(`${origin}/api/users`, { headers: { authorization: `Bearer ${reply.body.access_token}` } });
    expect(api.status).toBe(401);
  });

  it('refreshes to new tokens; the old refresh token stops working', async () => {
    const first = (await exchange()).body;
    const refreshed = await tokenRequest({ grant_type: 'refresh_token', refresh_token: first.refresh_token, client_id: fixture.clientId });
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.refresh_token).not.toBe(first.refresh_token);
    expect(await mcpStatus(refreshed.body.access_token)).toBe(200);
    const again = await tokenRequest({ grant_type: 'refresh_token', refresh_token: first.refresh_token, client_id: fixture.clientId });
    expect(again).toMatchObject({ status: 400, body: { error: 'invalid_grant' } });
  });

  it('answers RFC 6749 errors', async () => {
    const { code } = await approve();
    const cases: Array<[Record<string, string>, string]> = [
      [{ grant_type: 'authorization_code', code, code_verifier: 'wrong-verifier-wrong-verifier-wrong-verif', client_id: fixture.clientId, redirect_uri: REDIRECT_URI }, 'invalid_grant'],
      [{ grant_type: 'authorization_code', code, client_id: fixture.clientId }, 'invalid_request'],
      [{ grant_type: 'password', client_id: fixture.clientId }, 'unsupported_grant_type'],
      [{ grant_type: 'refresh_token', refresh_token: 'x' }, 'invalid_request'],
    ];
    for (const [fields, error] of cases) expect((await tokenRequest(fields)).body.error).toBe(error);
  });

  it('accepts a JSON body and a host-parsed repeated field', async () => {
    const { code, verifier } = await approve();
    const reply = await tokenRequest({
      grant_type: 'authorization_code', code, code_verifier: verifier, client_id: [fixture.clientId] as unknown as string, redirect_uri: REDIRECT_URI,
    }, true);
    expect(reply.status).toBe(200);
  });
});

describe('POST /api/oauth/revoke', () => {
  it('revoking the refresh token ends the grant: /mcp refuses its access token at once', async () => {
    const tokens = (await exchange()).body;
    const res = await fetch(`${origin}/api/oauth/revoke`, {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form({ token: tokens.refresh_token, client_id: fixture.clientId }),
    });
    expect(res.status).toBe(200);
    expect(await mcpStatus(tokens.access_token)).toBe(401);
    const refresh = await tokenRequest({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token, client_id: fixture.clientId });
    expect(refresh.body.error).toBe('invalid_grant');
  });

  it('revoking an access token ends its grant; unknown tokens still get 200', async () => {
    const tokens = (await exchange()).body;
    const revoke = (token: string) => fetch(`${origin}/api/oauth/revoke`, {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form({ token, client_id: fixture.clientId }),
    });
    expect((await revoke(tokens.access_token)).status).toBe(200);
    expect(await mcpStatus(tokens.access_token)).toBe(401);
    const { gid } = JSON.parse(Buffer.from(tokens.access_token.split('.')[1], 'base64url').toString());
    const { rows } = await getPool().query('SELECT revoked_at FROM lt_oauth_grants WHERE id = $1', [gid]);
    expect(rows[0].revoked_at).not.toBeNull();
    expect((await revoke('not-a-token')).status).toBe(200);
  });
});
