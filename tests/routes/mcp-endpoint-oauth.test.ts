import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import type { Server } from 'http';
import type { AddressInfo } from 'net';

// OAuth access tokens at /mcp, through the real route and MCP transport.

const mocks = vi.hoisted(() => ({
  listEscalations: vi.fn(async () => ({ status: 200, data: { escalations: [], total: 0 } })),
  isSuperAdmin: vi.fn(async () => false),
  hasRole: vi.fn(async () => false),
}));

vi.mock('../../services/domain', () => ({ getDomainIndex: vi.fn(async () => null), getDomainDictionary: vi.fn(async () => null) }));
vi.mock('../../services/user', async (io) => ({ ...(await io<typeof import('../../services/user')>()), isSuperAdmin: mocks.isSuperAdmin }));
vi.mock('../../services/user/roles', async (io) => ({ ...(await io<typeof import('../../services/user/roles')>()), hasRole: mocks.hasRole }));
vi.mock('../../api/escalations', async (io) => ({ ...(await io<typeof import('../../api/escalations')>()), listEscalations: mocks.listEscalations }));

import mcpRouter from '../../routes/mcp-endpoint';
import { config } from '../../modules/config';
import { setOAuthServerConfig, clearOAuthServerConfig } from '../../modules/oauth-server';
import { signAccessToken } from '../../services/auth/oauth-server';
import { createApp, jsonBody } from '../../lib/http';
import type { LTGrantSnapshot } from '../../types';

const USER = '00000000-0000-4000-8000-0000000000e9';
let server: Server;
let url: string;
let issuer: string;
let savedSecret: string;

const grant = (preset: 'read_only' | 'just_me'): LTGrantSnapshot => ({
  grant_id: '00000000-0000-4000-8000-0000000000f9', user_id: USER, client_id: 'ltc_c',
  policy: { preset }, scope: preset === 'read_only' ? 'mcp:read' : 'mcp:full',
  roles: [{ role: 'reviewer', type: 'member', read_scope: 'all', write_scope: 'all' }],
});
const tokenFor = (preset: 'read_only' | 'just_me') =>
  signAccessToken(grant(preset), { issuer, audience: `${issuer}/mcp` }).token;

async function rpc(token: string | null, method: string, params: unknown) {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      'content-type': 'application/json', accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const text = await res.text();
  const data = text.split('\n').find((line) => line.startsWith('data: '));
  return { status: res.status, challenge: res.headers.get('www-authenticate'), body: JSON.parse(data ? data.slice(6) : text) };
}

const toolNames = async (token: string) =>
  (await rpc(token, 'tools/list', {})).body.result.tools.map((t: { name: string }) => t.name) as string[];

beforeAll(async () => {
  savedSecret = config.JWT_SECRET;
  (config as any).JWT_SECRET = 'mcp-oauth-route-secret';
  const app = createApp();
  app.use(jsonBody());
  app.use('/mcp', mcpRouter);
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  issuer = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  url = `${issuer}/mcp`;
  setOAuthServerConfig({ issuer });
});

afterAll(async () => {
  clearOAuthServerConfig();
  (config as any).JWT_SECRET = savedSecret;
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('/mcp with an OAuth access token', () => {
  it('a missing credential gets 401 with the resource metadata challenge', async () => {
    const reply = await rpc(null, 'tools/list', {});
    expect(reply.status).toBe(401);
    expect(reply.challenge).toBe(`Bearer resource_metadata="http://127.0.0.1:${new URL(issuer).port}/.well-known/oauth-protected-resource/mcp"`);
  });

  it('a call reaches api/ as the person', async () => {
    const reply = await rpc(tokenFor('read_only'), 'tools/call', { name: 'find_escalations', arguments: {} });
    expect(reply.body.result.isError).toBeFalsy();
    expect((mocks.listEscalations.mock.calls.at(-1) as unknown[] | undefined)?.at(-1)).toMatchObject({ userId: USER, principalType: 'oauth' });
  });

  it('a read-only grant sees reads only; just-me also sees the person\'s writes', async () => {
    const readOnly = await toolNames(tokenFor('read_only'));
    const justMe = await toolNames(tokenFor('just_me'));
    expect(readOnly).toContain('find_escalations');
    expect(readOnly).not.toContain('admin_resolve_escalation');
    expect(justMe).toContain('admin_resolve_escalation');
    for (const names of [readOnly, justMe]) expect(names).not.toContain('create_user');
  });

  it('listing tools costs no capability lookup', async () => {
    mocks.isSuperAdmin.mockClear();
    mocks.hasRole.mockClear();
    await toolNames(tokenFor('just_me'));
    expect(mocks.isSuperAdmin).not.toHaveBeenCalled();
    expect(mocks.hasRole).not.toHaveBeenCalled();
  });

  it('an expired token gets 401 invalid_token', async () => {
    const expired = signAccessToken(grant('read_only'), { issuer, audience: `${issuer}/mcp` }, -1).token;
    const reply = await rpc(expired, 'tools/list', {});
    expect(reply.status).toBe(401);
    expect(reply.challenge).toContain('error="invalid_token"');
  });
});
