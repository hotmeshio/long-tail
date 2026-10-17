import { describe, it, expect, afterEach } from 'vitest';

import { LtHttp } from '../../../examples/workflows/machine-line/gateway/lt-http';
import { SESSION_KEY_NAME, adminToken, lineIdentities, provisionIdentities } from '../../../examples/workflows/machine-line/gateway/provision';
import { DEFAULT_LINE } from '../../../examples/workflows/machine-line/line';
import { FakeLtServer } from '../../helpers/machine-line-lt-server';

let server: FakeLtServer;
afterEach(async () => server?.stop());

/** Bot accounts with roles and keys, behind the bot-accounts routes. */
function botServer() {
  const bots = new Map<string, { id: string; external_id: string; roles: string[]; keys: { id: string; name: string }[] }>();
  let seq = 0;
  const s = new FakeLtServer()
    .on('GET', /^\/bot-accounts\?/, (r) => {
      const search = new URL(r.path, 'http://x').searchParams.get('search')!;
      return { status: 200, body: { bots: [...bots.values()].filter((b) => b.external_id.includes(search)), total: bots.size } };
    })
    .on('POST', /^\/bot-accounts$/, (r) => {
      const bot = { id: `b${++seq}`, external_id: r.body.name, roles: r.body.roles.map((x: any) => x.role), keys: [] };
      bots.set(bot.id, bot);
      return { status: 201, body: { id: bot.id } };
    })
    .on('GET', /\/roles$/, (r) => ({ status: 200, body: { roles: bots.get(r.path.split('/')[2])!.roles.map((role) => ({ role })) } }))
    .on('POST', /\/roles$/, (r) => {
      bots.get(r.path.split('/')[2])!.roles.push(r.body.role);
      return { status: 200, body: {} };
    })
    .on('GET', /\/api-keys$/, (r) => ({ status: 200, body: { keys: bots.get(r.path.split('/')[2])!.keys } }))
    .on('DELETE', /\/api-keys\//, (r) => {
      const [, , id, , keyId] = r.path.split('/');
      const bot = bots.get(id)!;
      bot.keys = bot.keys.filter((k) => k.id !== keyId);
      return { status: 200, body: { revoked: true } };
    })
    .on('POST', /\/api-keys$/, (r) => {
      const bot = bots.get(r.path.split('/')[2])!;
      const key = { id: `k${++seq}`, name: r.body.name };
      bot.keys.push(key);
      return { status: 201, body: { id: key.id, rawKey: `lt_bot_${key.id}` } };
    });
  return { s, bots };
}

describe('gateway identities', () => {
  it('a bot per machine on its station roles and line exit, plus the controller on the operator role', () => {
    const ids = lineIdentities(DEFAULT_LINE);
    expect(ids.map((i) => i.botName)).toEqual([
      'line-controller-site-1-line-1', 'machine-site-1-line-1-press-01', 'machine-site-1-line-1-cut-01', 'machine-site-1-line-1-inspect-01',
    ]);
    expect(ids[0].roles).toContain('line-operator');
    expect(ids[1].roles).toEqual(['line-bond', 'line-trim', 'line-inspect', 'line-exit']);
  });

  it('creates missing bots, then on the next boot reuses them, adds new roles and rotates the session key', async () => {
    const { s, bots } = botServer();
    server = await s.start();
    const http = new LtHttp(server.baseUrl);
    const first = await provisionIdentities(http, 'admin', DEFAULT_LINE);
    expect([...first.keys()]).toEqual(['controller', 'press-01', 'cut-01', 'inspect-01']);
    expect(bots.size).toBe(4);

    const press = [...bots.values()].find((b) => b.external_id.endsWith('press-01'))!;
    press.roles = press.roles.filter((r) => r !== 'line-exit');
    const second = await provisionIdentities(http, 'admin', DEFAULT_LINE);
    expect(bots.size).toBe(4);
    expect(press.roles).toContain('line-exit');
    expect(press.keys.filter((k) => k.name === SESSION_KEY_NAME)).toHaveLength(1);
    expect(second.get('press-01')).not.toBe(first.get('press-01'));
    expect(server.seen.every((r) => r.auth === 'Bearer admin')).toBe(true);
  });

  it('logs in with a token or a username and password, and refuses neither', async () => {
    server = await new FakeLtServer().on('POST', /^\/auth\/login$/, (r) => ({ status: 200, body: { token: `jwt-${r.body.username}` } })).start();
    const http = new LtHttp(server.baseUrl);
    expect(await adminToken(http, { LT_GATEWAY_TOKEN: 'lt_bot_x' })).toBe('lt_bot_x');
    expect(await adminToken(http, { LT_GATEWAY_USERNAME: 'ops', LT_GATEWAY_PASSWORD: 'pw' })).toBe('jwt-ops');
    await expect(adminToken(http, {})).rejects.toThrow(/LT_GATEWAY_TOKEN/);
  });
});
