import { describe, it, expect, afterEach } from 'vitest';

import { HttpLineEscalations, LtHttp, LtHttpError } from '../../../examples/workflows/machine-line/gateway/lt-http';
import { FakeLtServer } from '../../helpers/machine-line-lt-server';

let server: FakeLtServer;
afterEach(async () => server?.stop());

const tokens: Record<string, string> = { controller: 'tok-controller', 'press-01': 'tok-press' };
const client = (s: FakeLtServer, timeoutMs?: number) => new HttpLineEscalations(new LtHttp(s.baseUrl, timeoutMs), (a) => tokens[a]);

describe('Long Tail HTTP client', () => {
  it('runs each verb with the bearer token of the actor it runs as', async () => {
    server = await new FakeLtServer().on('POST', /\/claim$/, () => ({ status: 200, body: { ok: true } })).start();
    expect(await client(server).claim('press-01', 'e1')).toEqual({ outcome: 'done' });
    expect(server.seen[0]).toMatchObject({ path: '/escalations/e1/claim', auth: 'Bearer tok-press', body: { durationMinutes: 1440 } });
  });

  it('maps 404 and 409 to already, 422 to invalid', async () => {
    server = await new FakeLtServer()
      .on('POST', /e404\/resolve$/, () => ({ status: 404, body: { error: 'Escalation not found' } }))
      .on('POST', /e409\/resolve$/, () => ({ status: 409, body: { error: 'already resolved' } }))
      .on('POST', /e422\/resolve$/, () => ({ status: 422, body: { code: 'schema_validation' } }))
      .start();
    const lt = client(server);
    expect((await lt.resolve('controller', 'e404', {})).outcome).toBe('already');
    expect((await lt.resolve('controller', 'e409', {})).outcome).toBe('already');
    expect(await lt.resolve('controller', 'e422', { decision: 'x' })).toMatchObject({ outcome: 'invalid', detail: expect.stringContaining('schema_validation') });
    expect(server.seen[2].body).toEqual({ resolverPayload: { decision: 'x' } });
  });

  it('throws a typed error with status, body and request on any other failure', async () => {
    server = await new FakeLtServer().on('POST', /accumulate$/, () => ({ status: 500, body: { error: 'boom' } })).start();
    const err = await client(server).accumulate('press-01', 'e1', 'arrived:U1', {}).catch((e) => e);
    expect(err).toBeInstanceOf(LtHttpError);
    expect(err).toMatchObject({ status: 500, body: { error: 'boom' }, context: { method: 'POST', path: '/escalations/e1/accumulate' } });
  });

  it('times out with AbortController and reports no status', async () => {
    server = await new FakeLtServer().on('GET', /items$/, () => new Promise((r) => setTimeout(() => r({ status: 200, body: { items: [] } }), 200))).start();
    const err = await client(server, 30).itemKeys('e1').catch((e) => e);
    expect(err).toBeInstanceOf(LtHttpError);
    expect(err.status).toBeUndefined();
    expect(err.message).toMatch(/timed out after 30 ms/);
  });

  it('creates rows, reads item keys and lists open rows as the controller', async () => {
    server = await new FakeLtServer()
      .on('POST', /^\/escalations$/, () => ({ status: 201, body: { id: 'e9' } }))
      .on('GET', /\/items$/, () => ({ status: 200, body: { items: [{ itemKey: 'arrived:U1' }, { itemKey: 'released:U1' }] } }))
      .on('GET', /^\/escalations\?/, () => ({ status: 200, body: { escalations: [{ id: 'e1', type: 'handoff' }], total: 1 } }))
      .start();
    const lt = client(server);
    expect(await lt.create('controller', { type: 'line-alarm', role: 'line-operator', description: 'd', priority: 1, metadata: {} })).toEqual({ id: 'e9' });
    expect(await lt.itemKeys('e1')).toEqual(['arrived:U1', 'released:U1']);
    expect(await lt.listOpen('handoff')).toEqual([{ id: 'e1', type: 'handoff' }]);
    expect(server.seen[2].path).toBe('/escalations?type=handoff&status=pending&limit=500');
    expect(server.seen.every((s) => s.auth === 'Bearer tok-controller')).toBe(true);
  });
});
