import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import { Client } from 'pg';

// Database round trips per request, over REST and /mcp, for a member with a
// dashboard login. Every statement on every connection is counted, so a
// change that adds a query to these paths fails here.

import { migrate } from '../../lib/db/migrate';
import { getPool } from '../../lib/db';
import { config } from '../../modules/config';
import { signToken } from '../../modules/auth';
import { createApp, jsonBody } from '../../lib/http';
import routes from '../../routes';
import mcpRouter from '../../routes/mcp-endpoint';
import * as userService from '../../services/user';
import * as escalationService from '../../services/escalation';

const STAMP = Date.now();
const ROLE = `rt-queue-${STAMP}`;
let server: Server;
let base: string;
let token: string;
let userId: string;
let savedSecret: string;
const statements: string[] = [];
const originalQuery = Client.prototype.query;

async function measure(run: () => Promise<unknown>): Promise<string[]> {
  await new Promise((r) => setTimeout(r, 50));
  statements.length = 0;
  await run();
  await new Promise((r) => setTimeout(r, 100));
  return [...statements];
}

async function call(method: string, path: string, body?: unknown): Promise<any> {
  const res = await fetch(`${base}/api${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json();
  expect(res.status, JSON.stringify(json)).toBeLessThan(300);
  return json;
}

async function mcp(name: string, args: Record<string, unknown>): Promise<any> {
  const res = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  const line = (await res.text()).split('\n').find((l) => l.startsWith('data: '))!;
  const reply = JSON.parse(line.slice(6));
  expect(reply.result.isError, reply.result.content?.[0]?.text).toBeFalsy();
  return JSON.parse(reply.result.content[0].text);
}

const get = (path: string) => call('GET', path);
const post = (path: string, body: unknown) => call('POST', path, body);

const newEscalation = async () => (await escalationService.createEscalation({
  type: 'round-trip-probe', role: ROLE, description: 'round trip probe', metadata: {},
} as any)).id;

beforeAll(async () => {
  await migrate();
  savedSecret = config.JWT_SECRET;
  (config as any).JWT_SECRET = 'round-trip-secret';
  const user = await userService.createUser({
    external_id: `rt-member-${STAMP}`,
    roles: [{ role: ROLE, type: 'member', read_scope: 'all', write_scope: 'all' } as any],
  });
  userId = user.id;
  token = signToken({ userId, role: 'member', roles: [{ role: ROLE, type: 'member' }] });
  const app = createApp();
  app.use(jsonBody());
  app.use('/api', routes);
  app.use('/mcp', mcpRouter);
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  (Client.prototype as any).query = function (this: Client, ...args: any[]) {
    const text = typeof args[0] === 'string' ? args[0] : args[0]?.text;
    if (text) statements.push(String(text).replace(/\s+/g, ' ').trim().slice(0, 120));
    return (originalQuery as any).apply(this, args);
  };
  // Warm caches (domain index, schema enforcement) so steady state is measured.
  await get(`/escalations?role=${ROLE}&limit=1`);
  await mcp('find_escalations', { role: ROLE, limit: 1 });
  const warm = await newEscalation();
  await post(`/escalations/${warm}/resolve`, { resolverPayload: { ok: true } });
}, 60_000);

afterAll(async () => {
  Client.prototype.query = originalQuery;
  (config as any).JWT_SECRET = savedSecret;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await getPool().query('DELETE FROM lt_users WHERE id = $1', [userId]);
});

// Statements served from a TTL cache on a warm path are left out, so the
// counts do not depend on cache timing.
const CACHED = /pending_by_role|FROM lt_roles WHERE enforce_schema/;
const count = (run: () => Promise<unknown>) => measure(run).then((all) => all.filter((q) => !CACHED.test(q)).length);

// Measured budgets. A change that adds a query to one of these paths fails here.
const BUDGET = { list: 5, stats: 3, claim: 5, resolve: 11 };

describe('round trips per request (member, dashboard login)', () => {
  it('listing escalations costs the same over /mcp as over REST', async () => {
    const rest = await count(() => get(`/escalations?role=${ROLE}&limit=5`));
    const viaMcp = await count(() => mcp('find_escalations', { role: ROLE, limit: 5 }));
    expect(viaMcp).toBe(rest);
    expect(rest).toBeLessThanOrEqual(BUDGET.list);
  });

  it('escalation stats cost the same over /mcp as over REST', async () => {
    const rest = await count(() => get('/escalations/stats'));
    const viaMcp = await count(() => mcp('get_escalation_stats', {}));
    expect(viaMcp).toBe(rest);
    expect(rest).toBeLessThanOrEqual(BUDGET.stats);
  });

  it('claiming costs the same over /mcp as over REST', async () => {
    const [a, b] = [await newEscalation(), await newEscalation()];
    const rest = await count(() => post(`/escalations/${a}/claim`, {}));
    const viaMcp = await count(() => mcp('claim_escalation', { id: b }));
    expect(viaMcp).toBe(rest);
    expect(rest).toBeLessThanOrEqual(BUDGET.claim);
  });

  it('resolving costs the same over /mcp as over REST', async () => {
    const [a, b] = [await newEscalation(), await newEscalation()];
    await post(`/escalations/${a}/claim`, {});
    await mcp('claim_escalation', { id: b });
    const rest = await count(() => post(`/escalations/${a}/resolve`, { resolverPayload: { ok: true } }));
    const viaMcp = await count(() => mcp('admin_resolve_escalation', { id: b, resolverPayload: { ok: true } }));
    expect(viaMcp).toBe(rest);
    expect(rest).toBeLessThanOrEqual(BUDGET.resolve);
  });

  it('authentication adds no statement for a dashboard login', async () => {
    const statements = await measure(() => mcp('find_escalations', { role: ROLE, limit: 1 }));
    expect(statements.filter((q) => /lt_bot_api_keys|FROM lt_users WHERE/.test(q))).toEqual([]);
  });
});
