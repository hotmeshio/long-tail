import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import type { Server } from 'http';
import type { AddressInfo } from 'net';

import { createApp } from '../../lib/http';
import { LTExpressAdapter } from '../../adapters/express';
import { setOAuthServerConfig, clearOAuthServerConfig } from '../../modules/oauth-server';

// The well-known router mounted at a host's root, ahead of the host's own routes.

let server: Server;
let base: string;

beforeAll(async () => {
  const app = createApp();
  app.use(new LTExpressAdapter().getWellKnownRouter());
  app.all('/{*splat}', (req, res) => { res.status(299).json({ host: req.method + ' ' + req.path }); });
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); });
afterEach(() => clearOAuthServerConfig());

const get = async (path: string, init?: RequestInit) => {
  const res = await fetch(`${base}${path}`, init);
  return { status: res.status, cors: res.headers.get('access-control-allow-origin'), body: res.status === 204 ? null : await res.json() };
};

describe('OAuth well-known router', () => {
  it('passes everything through when the OAuth server is not configured', async () => {
    expect((await get('/.well-known/oauth-authorization-server')).status).toBe(299);
    expect((await get('/.well-known/oauth-protected-resource/mcp')).status).toBe(299);
  });

  it('serves both documents for an issuer at the root', async () => {
    setOAuthServerConfig({ issuer: 'http://lt.example' });
    const as = await get('/.well-known/oauth-authorization-server');
    expect(as.status).toBe(200);
    expect(as.body).toMatchObject({
      issuer: 'http://lt.example',
      authorization_endpoint: 'http://lt.example/api/oauth/authorize',
      token_endpoint: 'http://lt.example/api/oauth/token',
      registration_endpoint: 'http://lt.example/api/oauth/register',
      revocation_endpoint: 'http://lt.example/api/oauth/revoke',
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
    });
    const pr = await get('/.well-known/oauth-protected-resource/mcp');
    expect(pr.body).toEqual({
      resource: 'http://lt.example/mcp', authorization_servers: ['http://lt.example'],
      bearer_methods_supported: ['header'], scopes_supported: ['mcp:read', 'mcp:full'],
    });
  });

  it('inserts the issuer\'s base path and leaves the root document to the host', async () => {
    setOAuthServerConfig({ issuer: 'https://api.example.com/longtail' });
    expect((await get('/.well-known/oauth-authorization-server/longtail')).body.issuer).toBe('https://api.example.com/longtail');
    expect((await get('/.well-known/oauth-protected-resource/longtail/mcp')).body.resource).toBe('https://api.example.com/longtail/mcp');
    expect((await get('/.well-known/oauth-authorization-server')).body).toEqual({ host: 'GET /.well-known/oauth-authorization-server' });
  });

  it('passes other paths and methods through to the host', async () => {
    setOAuthServerConfig({ issuer: 'http://lt.example' });
    expect((await get('/v2/orders')).body).toEqual({ host: 'GET /v2/orders' });
    expect((await get('/.well-known/oauth-protected-resource/other')).status).toBe(299);
    expect((await get('/.well-known/oauth-authorization-server', { method: 'POST' })).status).toBe(299);
  });

  it('allows any origin, and answers preflight', async () => {
    setOAuthServerConfig({ issuer: 'http://lt.example' });
    expect((await get('/.well-known/oauth-authorization-server')).cors).toBe('*');
    const preflight = await get('/.well-known/oauth-protected-resource/mcp', { method: 'OPTIONS' });
    expect(preflight).toMatchObject({ status: 204, cors: '*' });
  });
});
