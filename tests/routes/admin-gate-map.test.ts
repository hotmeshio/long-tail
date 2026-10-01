import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import type { Server } from 'http';
import type { AddressInfo } from 'net';

// Characterization of which gate guards every route in the gated route files,
// driven through the real router. Every api module those routes call is
// stubbed and the database pool throws, so no handler can have side effects.

const lookups = vi.hoisted(() => ({
  isSuperAdmin: vi.fn(async (_userId: string) => false),
  hasRole: vi.fn(async (_userId: string, _role: string) => false),
}));

const stubApi = vi.hoisted(() => async (importOriginal: () => Promise<Record<string, unknown>>) => {
  const original = await importOriginal();
  return Object.fromEntries(Object.entries(original).map(([name, value]) => [
    name,
    typeof value === 'function' ? vi.fn(() => ({ status: 299, data: { reached: name } })) : value,
  ]));
});

vi.mock('../../api/users', (io) => stubApi(io as any));
vi.mock('../../api/personas', (io) => stubApi(io as any));
vi.mock('../../api/roles', (io) => stubApi(io as any));
vi.mock('../../api/bot-accounts', (io) => stubApi(io as any));
vi.mock('../../api/workflows', (io) => stubApi(io as any));
vi.mock('../../api/knowledge', (io) => stubApi(io as any));
vi.mock('../../api/domain', (io) => stubApi(io as any));
vi.mock('../../api/scan-codes', (io) => stubApi(io as any));
vi.mock('../../api/announcements', (io) => stubApi(io as any));
vi.mock('../../api/maintenance', (io) => stubApi(io as any));
vi.mock('../../api/dba', (io) => stubApi(io as any));
vi.mock('../../api/diagnostics', (io) => stubApi(io as any));
vi.mock('../../api/controlplane', (io) => stubApi(io as any));
vi.mock('../../api/files', (io) => stubApi(io as any));
vi.mock('../../api/insight', (io) => stubApi(io as any));
vi.mock('../../api/workflow-sets', (io) => stubApi(io as any));
vi.mock('../../api/namespaces', (io) => stubApi(io as any));
vi.mock('../../api/pipelines', (io) => stubApi(io as any));
vi.mock('../../api/topics', (io) => stubApi(io as any));
vi.mock('../../api/agents', (io) => stubApi(io as any));
vi.mock('../../api/agent-subscriptions', (io) => stubApi(io as any));
vi.mock('../../api/yaml-workflows', (io) => stubApi(io as any));
vi.mock('../../lib/db', async (io) => ({
  ...(await io<typeof import('../../lib/db')>()),
  getPool: () => { throw new Error('database disabled in the gate map test'); },
}));
vi.mock('../../services/user', async (io) => ({ ...(await io<typeof import('../../services/user')>()), isSuperAdmin: lookups.isSuperAdmin }));
vi.mock('../../services/user/rbac', async (io) => ({ ...(await io<typeof import('../../services/user/rbac')>()), isSuperAdmin: lookups.isSuperAdmin }));
vi.mock('../../services/user/roles', async (io) => ({ ...(await io<typeof import('../../services/user/roles')>()), hasRole: lookups.hasRole }));

import routes from '../../routes';
import { config } from '../../modules/config';
import { signToken } from '../../modules/auth';
import { createApp, jsonBody } from '../../lib/http';
import { GATED_ROUTES, GATE_DENIALS, type Gate } from '../helpers/admin-gate-routes';

type Person = 'member' | 'groupAdmin' | 'engineer' | 'superadmin';
const USER = '00000000-0000-4000-8000-0000000000b1';
const CLAIM: Record<Person, string> = { member: 'member', groupAdmin: 'admin', engineer: 'member', superadmin: 'superadmin' };
const ALLOWED: Record<Gate, Person[]> = {
  none: ['member', 'groupAdmin', 'engineer', 'superadmin'],
  admin: ['groupAdmin', 'superadmin'],
  builder: ['engineer', 'superadmin'],
  roleManager: ['groupAdmin', 'engineer', 'superadmin'],
};

let server: Server;
let base: string;
let savedSecret: string;

beforeAll(async () => {
  savedSecret = config.JWT_SECRET;
  (config as any).JWT_SECRET = 'gate-map-test-secret';
  const app = createApp();
  app.use(jsonBody());
  app.use('/api', routes);
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});

afterAll(async () => {
  (config as any).JWT_SECRET = savedSecret;
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

/** 'denied' when a gate refused the request; otherwise the handler was reached. */
async function attempt(person: Person, method: string, path: string, body?: unknown): Promise<{ denied: boolean; status: number; error?: string }> {
  lookups.isSuperAdmin.mockResolvedValue(false);
  lookups.hasRole.mockImplementation(async (_id, role) => person === 'engineer' && role === 'engineer');
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { authorization: `Bearer ${signToken({ userId: USER, role: CLAIM[person] })}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const error = (() => { try { return JSON.parse(text).error as string | undefined; } catch { return undefined; } })();
  const denied = res.status === 401 || (res.status === 403 && GATE_DENIALS.includes(error ?? ''));
  return { denied, status: res.status, error };
}

describe('gate placement for every route in the gated route files (characterization)', () => {
  for (const route of GATED_ROUTES) {
    it(`${route.method} ${route.path} is guarded by: ${route.gate}`, async () => {
      for (const person of ['member', 'groupAdmin', 'engineer', 'superadmin'] as Person[]) {
        const { denied, status, error } = await attempt(person, route.method, route.path, route.body);
        expect({ person, denied, status, error }).toMatchObject({ person, denied: !ALLOWED[route.gate].includes(person) });
        expect({ person, status }).not.toMatchObject({ status: 404 });
      }
    });
  }
});

describe('POST /users/:id/roles grant rules inside the route (characterization)', () => {
  const path = `/users/${USER}/roles`;

  it('a superadmin may grant any role and type', async () => {
    lookups.isSuperAdmin.mockResolvedValue(true);
    const res = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${signToken({ userId: USER, role: 'superadmin' })}`, 'content-type': 'application/json' },
      body: JSON.stringify({ role: 'any-role', type: 'superadmin' }),
    });
    expect(res.status).toBe(299);
  });

  it('a group admin may grant only roles they hold', async () => {
    lookups.isSuperAdmin.mockResolvedValue(false);
    const headers = { authorization: `Bearer ${signToken({ userId: USER, role: 'admin' })}`, 'content-type': 'application/json' };
    lookups.hasRole.mockImplementation(async (_id, role) => role === 'held-role');
    const held = await fetch(`${base}${path}`, { method: 'POST', headers, body: JSON.stringify({ role: 'held-role', type: 'member' }) });
    const notHeld = await fetch(`${base}${path}`, { method: 'POST', headers, body: JSON.stringify({ role: 'other-role', type: 'member' }) });
    expect(held.status).toBe(299);
    expect(notHeld.status).toBe(403);
    expect((await notHeld.json()).error).toBe("You can only assign roles you hold. You do not have the 'other-role' role.");
  });

  it('nobody but a superadmin may grant the superadmin type', async () => {
    lookups.isSuperAdmin.mockResolvedValue(false);
    lookups.hasRole.mockResolvedValue(true);
    const res = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${signToken({ userId: USER, role: 'admin' })}`, 'content-type': 'application/json' },
      body: JSON.stringify({ role: 'any-role', type: 'superadmin' }),
    });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe('Only superadmin can assign superadmin role type');
  });

  it('an engineer with an admin claim may grant roles they do not hold', async () => {
    lookups.isSuperAdmin.mockResolvedValue(false);
    lookups.hasRole.mockImplementation(async (_id, role) => role === 'engineer');
    const res = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${signToken({ userId: USER, role: 'admin' })}`, 'content-type': 'application/json' },
      body: JSON.stringify({ role: 'other-role', type: 'admin' }),
    });
    expect(res.status).toBe(299);
  });
});
