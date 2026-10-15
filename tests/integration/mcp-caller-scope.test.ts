/**
 * A reviewer sees the same escalations over /mcp as over REST.
 *
 * Creates a reviewer (member, read all, write none) through the public API,
 * then compares what REST and /mcp return for them and for superadmin.
 *
 * Requires docker compose up (the app must be running on port 3000).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

import { ApiClient, waitForHealth } from './helpers';

const BASE_URL = process.env.LT_BASE_URL || 'http://localhost:3000';
const REVIEWER_ID = `mcp-reviewer-probe-${Date.now()}`;
const REVIEWER_PASSWORD = 'probe-pass-1';

let admin: ApiClient;
let reviewer: ApiClient;
let adminToken: string;
let reviewerToken: string;
let reviewerUserId: string;

async function callTool<T = any>(token: string, name: string, args: Record<string, unknown> = {}): Promise<T> {
  const client = new Client({ name: 'reviewer-probe', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${BASE_URL}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  }));
  try {
    const result = await client.callTool({ name, arguments: args }) as { content: Array<{ text: string }>; isError?: boolean };
    expect(result.isError, `${name} failed: ${result.content?.[0]?.text}`).toBeFalsy();
    return JSON.parse(result.content[0].text) as T;
  } finally {
    await client.close();
  }
}

async function listToolNames(token: string): Promise<string[]> {
  const client = new Client({ name: 'reviewer-probe', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${BASE_URL}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  }));
  try {
    return (await client.listTools()).tools.map((t) => t.name);
  } finally {
    await client.close();
  }
}

beforeAll(async () => {
  await waitForHealth(BASE_URL);
  admin = new ApiClient(BASE_URL);
  adminToken = await admin.login('superadmin', 'l0ngt@1l');
  const { data } = await admin.post<{ id: string }>('/api/users', {
    external_id: REVIEWER_ID,
    password: REVIEWER_PASSWORD,
    roles: [{ role: 'reviewer', type: 'member', read_scope: 'all', write_scope: 'none' }],
  });
  reviewerUserId = data.id;
  reviewer = new ApiClient(BASE_URL);
  reviewerToken = await reviewer.login(REVIEWER_ID, REVIEWER_PASSWORD);
}, 120_000);

afterAll(async () => {
  if (reviewerUserId) await admin.delete(`/api/users/${reviewerUserId}`);
});

describe('reviewer probe: /mcp matches REST', () => {
  it('find_escalations returns the same total as GET /api/escalations', async () => {
    const rest = (await reviewer.get<{ total: number }>('/api/escalations', { limit: '1' })).data;
    const mcp = await callTool<{ total: number }>(reviewerToken, 'find_escalations', { limit: 1 });
    expect(mcp.total).toBe(rest.total);
  });

  it('get_escalation_stats matches GET /api/escalations/stats', async () => {
    const rest = (await reviewer.get<Record<string, unknown>>('/api/escalations/stats')).data;
    const mcp = await callTool<Record<string, unknown>>(reviewerToken, 'get_escalation_stats');
    expect(mcp.pending).toBe(rest.pending);
    expect(mcp.by_role).toEqual(rest.by_role);
  });

  it('the reviewer sees fewer escalations than superadmin whenever REST does', async () => {
    const reviewerRest = (await reviewer.get<{ total: number }>('/api/escalations', { limit: '1' })).data.total;
    const adminRest = (await admin.get<{ total: number }>('/api/escalations', { limit: '1' })).data.total;
    const reviewerMcp = (await callTool<{ total: number }>(reviewerToken, 'find_escalations', { limit: 1 })).total;
    const adminMcp = (await callTool<{ total: number }>(adminToken, 'find_escalations', { limit: 1 })).total;
    expect(adminMcp).toBe(adminRest);
    if (reviewerRest < adminRest) expect(reviewerMcp).toBeLessThan(adminMcp);
  });

  it('the reviewer is not offered administrative or full-authority tools', async () => {
    const names = await listToolNames(reviewerToken);
    expect(names).toContain('find_escalations');
    for (const hidden of ['create_user', 'add_user_role', 'prune', 'list_bot_accounts', 'escalate_to_human']) {
      expect(names).not.toContain(hidden);
    }
  });
});
