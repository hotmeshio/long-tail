import { describe, it, expect } from 'vitest';
import { setupRouteTest, authHeaders } from './setup';

// MCP server writes need builder access: a stdio transport runs a command on
// the host. Reads hide transport_config, which carries connection secrets,
// from anyone who could not edit the server.
const ctx = setupRouteTest(4637);

const post = (path: string, token: string, body: unknown) =>
  fetch(`${ctx.BASE}${path}`, { method: 'POST', headers: authHeaders(token), body: JSON.stringify(body) });

describe('MCP server write gates', () => {
  for (const who of ['adminToken', 'memberToken'] as const) {
    it(`${who} cannot test a stdio connection`, async () => {
      const res = await post('/mcp/servers/test-connection', ctx[who], {
        transport_type: 'stdio', transport_config: { command: 'echo', args: ['owned'] },
      });
      expect(res.status).toBe(403);
    });

    it(`${who} cannot register, update, delete, connect or disconnect a server`, async () => {
      expect((await post('/mcp/servers', ctx[who], { name: 'x', transport_type: 'stdio', transport_config: { command: 'echo' } })).status).toBe(403);
      const id = '00000000-0000-4000-8000-000000000000';
      for (const [method, path] of [['PUT', `/mcp/servers/${id}`], ['DELETE', `/mcp/servers/${id}`], ['POST', `/mcp/servers/${id}/connect`], ['POST', `/mcp/servers/${id}/disconnect`]]) {
        const res = await fetch(`${ctx.BASE}${path}`, { method, headers: authHeaders(ctx[who]), body: '{}' });
        expect(res.status).toBe(403);
      }
    });
  }
});

describe('MCP server reads', () => {
  it('a builder sees transport_config; a member does not', async () => {
    const created = await post('/mcp/servers', ctx.builderToken, {
      name: `gate-probe-${Date.now()}`, transport_type: 'streamable-http',
      transport_config: { url: 'http://127.0.0.1:9/mcp', headers: { authorization: 'Bearer secret' } },
    });
    expect(created.status).toBe(201);
    const { id } = await created.json();
    try {
      const asBuilder = await (await fetch(`${ctx.BASE}/mcp/servers/${id}`, { headers: authHeaders(ctx.builderToken) })).json();
      expect(asBuilder.transport_config.headers.authorization).toBe('Bearer secret');

      const asMember = await (await fetch(`${ctx.BASE}/mcp/servers/${id}`, { headers: authHeaders(ctx.memberToken) })).json();
      expect(asMember).not.toHaveProperty('transport_config');
      expect(asMember.id).toBe(id);

      const list = await (await fetch(`${ctx.BASE}/mcp/servers?search=gate-probe`, { headers: authHeaders(ctx.memberToken) })).json();
      expect(list.servers.length).toBeGreaterThan(0);
      for (const srv of list.servers) expect(srv).not.toHaveProperty('transport_config');
    } finally {
      await fetch(`${ctx.BASE}/mcp/servers/${id}`, { method: 'DELETE', headers: authHeaders(ctx.builderToken) });
    }
  });
});

describe('REST tool call on a built-in server', () => {
  const call = (token: string, tool: string, args: Record<string, unknown> = {}) =>
    post(`/mcp/servers/long-tail-admin/tools/${tool}/call`, token, { arguments: args });

  it('a member is refused a builder-gated tool', async () => {
    const res = await call(ctx.memberToken, 'list_bot_accounts');
    expect(res.status).toBe(403);
  });

  it('a builder passes the gate (the route stack registers no built-in factories, so the call itself is not found)', async () => {
    const res = await call(ctx.builderToken, 'list_bot_accounts');
    expect([200, 404]).toContain(res.status);
  });

  it('a member may not act as the superadmin', async () => {
    const res = await post('/mcp/servers/long-tail-admin/tools/find_escalations/call', ctx.memberToken, {
      arguments: {}, execute_as: 'test-superadmin',
    });
    expect([403, 404]).toContain(res.status);
  });
});

describe('Capabilities listing', () => {
  const names = async (token: string) => {
    const body = await (await fetch(`${ctx.BASE}/capabilities`, { headers: authHeaders(token) })).json();
    return new Set<string>(body.categories.flatMap((c: any) => c.tools.map((t: any) => t.name)));
  };

  it('lists only the built-in tools the caller may run', async () => {
    const [member, builder] = await Promise.all([names(ctx.memberToken), names(ctx.builderToken)]);
    expect(builder.has('list_bot_accounts')).toBe(true);
    expect(member.has('list_bot_accounts')).toBe(false);
  });
});
