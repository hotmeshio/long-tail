import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import type { Server } from 'http';
import type { AddressInfo } from 'net';

vi.mock('../../services/domain', () => ({ getDomainIndex: vi.fn(async () => null), getDomainDictionary: vi.fn(async () => null) }));

import { migrate } from '../../lib/db/migrate';
import { createApp, jsonBody } from '../../lib/http';
import routes from '../../routes';
import { config } from '../../modules/config';
import { signToken } from '../../modules/auth';
import * as userService from '../../services/user';
import { setOAuthServerConfig, clearOAuthServerConfig } from '../../modules/oauth-server';
import { REDIRECT_URI, pkcePair, createGrantFixture, removeGrantFixture } from '../helpers/oauth-server-fixtures';

// Malformed input answers in the RFC 6749 shape and never reaches SQL; the
// server grants only the presets the person may grant.
const STAMP = `${Date.now()}-hardening`;
let server: Server;
let origin: string;
let fixture: { userId: string; clientId: string };
let readOnlyUser: string;
let savedSecret: string;

const post = (path: string, body: string, contentType: string, token?: string) =>
  fetch(`${origin}/api/oauth/${path}`, {
    method: 'POST',
    headers: { 'content-type': contentType, ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body,
  });

beforeAll(async () => {
  await migrate();
  savedSecret = config.JWT_SECRET;
  (config as any).JWT_SECRET = 'hardening-secret';
  fixture = await createGrantFixture(STAMP, `oauth-hardening-${STAMP}`);
  readOnlyUser = (await userService.createUser({
    external_id: `oauth-hardening-ro-${STAMP}`,
    roles: [{ role: `oauth-hardening-${STAMP}`, type: 'member', read_scope: 'all', write_scope: 'none' } as any],
  })).id;
  const app = createApp();
  app.use(jsonBody());
  app.use('/api', routes);
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  setOAuthServerConfig({ issuer: origin });
}, 30_000);

afterAll(async () => {
  clearOAuthServerConfig();
  (config as any).JWT_SECRET = savedSecret;
  await removeGrantFixture(fixture);
  await userService.deleteUser(readOnlyUser);
  await new Promise<void>((resolve) => server.close(() => resolve()));
}, 15_000);

describe('control characters never reach SQL', () => {
  it('token: a NUL in client_id is a missing client_id', async () => {
    const res = await post('token', JSON.stringify({ grant_type: 'refresh_token', refresh_token: 'x', client_id: 'a\u0000b' }), 'application/json');
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'invalid_request' });
  });

  it('token: a NUL in redirect_uri is a missing field', async () => {
    const res = await post('token', JSON.stringify({
      grant_type: 'authorization_code', code: 'c', code_verifier: 'v'.repeat(43), client_id: fixture.clientId, redirect_uri: 'http://127.0.0.1/\u0000',
    }), 'application/json');
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'invalid_request' });
  });

  it('revoke: a NUL still answers 200', async () => {
    const res = await post('revoke', new URLSearchParams({ token: 'a\u0000b', client_id: 'c\u0000d' }).toString(), 'application/x-www-form-urlencoded');
    expect(res.status).toBe(200);
  });

  it('authorize: a NUL client_id is an unknown client, as JSON', async () => {
    const res = await fetch(`${origin}/api/oauth/authorize?client_id=a%00b&redirect_uri=x`, { redirect: 'manual' });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'invalid_client' });
  });

  it('register: a redirect URI with a control character is refused', async () => {
    const res = await post('register', JSON.stringify({ redirect_uris: ['http://127.0.0.1/c\nb'] }), 'application/json');
    expect(res.status).toBe(400);
  });
});

describe('PKCE verifier format', () => {
  it('a verifier shorter than 43 characters is refused before the code is checked', async () => {
    const res = await post('token', JSON.stringify({
      grant_type: 'authorization_code', code: 'c', code_verifier: 'short', client_id: fixture.clientId, redirect_uri: REDIRECT_URI,
    }), 'application/json');
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'invalid_request' });
  });
});

describe('presets at approval', () => {
  const approve = (userId: string, preset: string) => post('authorize', JSON.stringify({
    response_type: 'code', client_id: fixture.clientId, redirect_uri: REDIRECT_URI,
    code_challenge: pkcePair().challenge, code_challenge_method: 'S256', preset,
  }), 'application/json', signToken({ userId, role: 'member' }));

  it('a person who cannot write may not grant just_me', async () => {
    const res = await approve(readOnlyUser, 'just_me');
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: 'access_denied' });
  });

  it('the same person may grant read_only', async () => {
    expect((await approve(readOnlyUser, 'read_only')).status).toBe(200);
  });

  it('a person who can write may grant just_me', async () => {
    expect((await approve(fixture.userId, 'just_me')).status).toBe(200);
  });
});
