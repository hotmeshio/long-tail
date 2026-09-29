import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import type { Server } from 'http';
import type { AddressInfo } from 'net';

import { migrate } from '../../lib/db/migrate';
import { getPool } from '../../lib/db';
import { createApp, jsonBody } from '../../lib/http';
import routes from '../../routes';
import { setOAuthServerConfig, clearOAuthServerConfig } from '../../modules/oauth-server';
import { getClient } from '../../services/auth/oauth-server';
import { OAUTH_REGISTRATIONS_PER_WINDOW } from '../../modules/defaults';

let server: Server;
let base: string;
const registered: string[] = [];

beforeAll(async () => {
  await migrate();
  const app = createApp();
  app.use(jsonBody());
  app.use('/api', routes);
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/oauth`;
}, 30_000);

afterAll(async () => {
  await getPool().query('DELETE FROM lt_oauth_clients WHERE client_id = ANY($1)', [registered]);
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

afterEach(() => clearOAuthServerConfig());

const register = async (body: unknown, method = 'POST') => {
  const res = await fetch(`${base}/register`, {
    method, headers: { 'content-type': 'application/json' }, body: method === 'POST' ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, cors: res.headers.get('access-control-allow-origin'), body: res.status === 204 ? null : await res.json() };
};

describe('POST /api/oauth/register', () => {
  it('answers 404 while the OAuth server is not configured', async () => {
    expect((await register({ redirect_uris: ['http://127.0.0.1/cb'] })).status).toBe(404);
    expect((await fetch(`${base}/metadata`)).status).toBe(404);
  });

  it('registers a public client without a session, and stores it', async () => {
    setOAuthServerConfig({ issuer: 'http://lt.example' });
    const reply = await register({ client_name: 'Claude Code', redirect_uris: ['http://127.0.0.1:33418/callback'] });
    registered.push(reply.body.client_id);
    expect(reply.status).toBe(201);
    expect(reply.cors).toBe('*');
    expect(reply.body).toMatchObject({
      client_name: 'Claude Code', redirect_uris: ['http://127.0.0.1:33418/callback'],
      grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none',
    });
    expect(typeof reply.body.client_id_issued_at).toBe('number');
    expect(await getClient(reply.body.client_id)).toMatchObject({ client_name: 'Claude Code' });
  });

  it('refuses a disallowed redirect URI with an RFC 7591 error', async () => {
    setOAuthServerConfig({ issuer: 'http://lt.example', allowedRedirectHosts: ['claude.ai'] });
    const reply = await register({ redirect_uris: ['https://evil.example/cb'] });
    expect(reply.status).toBe(400);
    expect(reply.body.error).toBe('invalid_redirect_uri');
    const allowed = await register({ redirect_uris: ['https://claude.ai/api/mcp/auth_callback'] });
    registered.push(allowed.body.client_id);
    expect(allowed.status).toBe(201);
  });

  it('answers preflight for any origin', async () => {
    setOAuthServerConfig({ issuer: 'http://lt.example' });
    expect(await register(undefined, 'OPTIONS')).toMatchObject({ status: 204, cors: '*' });
  });

  it('limits registrations per address', async () => {
    setOAuthServerConfig({ issuer: 'http://lt.example' });
    let last = 0;
    for (let i = 0; i <= OAUTH_REGISTRATIONS_PER_WINDOW; i++) last = (await register({ redirect_uris: [] })).status;
    expect(last).toBe(429);
  });

  it('serves the authorization server metadata at /api/oauth/metadata', async () => {
    setOAuthServerConfig({ issuer: 'http://lt.example' });
    const res = await fetch(`${base}/metadata`);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect((await res.json()).registration_endpoint).toBe('http://lt.example/api/oauth/register');
  });
});
