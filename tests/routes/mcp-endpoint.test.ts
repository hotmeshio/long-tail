import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import type { Server } from 'http';
import type { AddressInfo } from 'net';

// The caller's identity travels from the /mcp bearer token through the MCP
// transport to the api/ call a tool makes.

const mocks = vi.hoisted(() => ({
  listEscalations: vi.fn(async () => ({ status: 200, data: { escalations: [], total: 0 } })),
}));

vi.mock('../../services/domain', () => ({ getDomainIndex: vi.fn(async () => null), getDomainDictionary: vi.fn(async () => null) }));
vi.mock('../../services/user', async (io) => ({ ...(await io<typeof import('../../services/user')>()), isSuperAdmin: vi.fn(async () => false) }));
vi.mock('../../services/user/roles', async (io) => ({ ...(await io<typeof import('../../services/user/roles')>()), hasRole: vi.fn(async () => false) }));
vi.mock('../../api/escalations', async (io) => ({
  ...(await io<typeof import('../../api/escalations')>()),
  listEscalations: mocks.listEscalations,
}));

import mcpRouter from '../../routes/mcp-endpoint';
import { config } from '../../modules/config';
import { signToken } from '../../modules/auth';
import { createApp, jsonBody } from '../../lib/http';

const MEMBER = '00000000-0000-4000-8000-0000000000d1';
let server: Server;
let url: string;
let savedSecret: string;

beforeAll(async () => {
  savedSecret = config.JWT_SECRET;
  (config as any).JWT_SECRET = 'mcp-endpoint-test-secret';
  const app = createApp();
  app.use(jsonBody());
  app.use('/mcp', mcpRouter);
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`;
});

afterAll(async () => {
  (config as any).JWT_SECRET = savedSecret;
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function rpc(token: string, method: string, params: unknown): Promise<any> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const text = await res.text();
  const data = text.split('\n').find((line) => line.startsWith('data: '));
  return JSON.parse(data ? data.slice(6) : text);
}

describe('/mcp caller identity', () => {
  it('a member token reaches api/ as that member', async () => {
    const token = signToken({ userId: MEMBER, role: 'member' });
    const reply = await rpc(token, 'tools/call', { name: 'find_escalations', arguments: {} });
    expect(reply.result.isError).toBeFalsy();
    const auth = (mocks.listEscalations.mock.calls.at(-1) as unknown[] | undefined)?.at(-1);
    expect(auth).toMatchObject({ userId: MEMBER, role: 'member' });
  });

  it('a member does not see administrative tools', async () => {
    const token = signToken({ userId: MEMBER, role: 'member' });
    const names = (await rpc(token, 'tools/list', {})).result.tools.map((t: { name: string }) => t.name);
    expect(names).toContain('find_escalations');
    expect(names).not.toContain('create_user');
    expect(names).not.toContain('prune');
  });
});
