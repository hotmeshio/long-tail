import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createHash } from 'node:crypto';

// Controllable fake transport — set `h.handler` per test. Login endpoints are
// answered by `loginOr` so any authed call can reach its target.
const h = vi.hoisted(() => ({
  calls: [] as Array<{ method: string; path: string; body: string }>,
  handler: (_m: string, _p: string, _b: Buffer): { status: number; json?: unknown; networkError?: boolean } => ({ status: 200, json: {} }),
}));

vi.mock('node:fs', () => ({ readFileSync: () => Buffer.from('cert') }));
vi.mock('node:https', () => {
  class Agent {
    constructor(_o: unknown) {}
  }
  function request(opts: any, cb: (res: any) => void) {
    const chunks: Buffer[] = [];
    let onErr: (e: Error) => void = () => {};
    const req: any = {
      on: (ev: string, fn: any) => {
        if (ev === 'error') onErr = fn;
        return req;
      },
      write: (c: Buffer) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)),
      end: () => {
        const body = Buffer.concat(chunks);
        const r = h.handler(opts.method, opts.path, body);
        h.calls.push({ method: opts.method, path: opts.path, body: body.toString('utf8') });
        if (r.networkError) return onErr(new Error('ECONNREFUSED'));
        const res: any = {
          statusCode: r.status,
          headers: { 'content-type': 'application/json' },
          on: (ev: string, fn: any) => {
            if (ev === 'data' && r.json !== undefined) fn(Buffer.from(JSON.stringify(r.json)));
            if (ev === 'end') fn();
            return res;
          },
        };
        cb(res);
      },
    };
    return req;
  }
  return { Agent, request };
});

import { httpBackend, __resetHttpBackend, BambuHttpError } from '../../examples/workflows/printer-twin/activities/bambu-http';

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64');
const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

const loginOr =
  (fn: (m: string, p: string, b: Buffer) => { status: number; json?: unknown; networkError?: boolean }) =>
  (m: string, p: string, b: Buffer) => {
    if (p === '/login/local/tickets') return { status: 200, json: { code: 0, ticket_id: 1, ticket: b64({ challenge: 'c', salt: 's' }) } };
    if (p === '/login/local/tokens') return { status: 200, json: { code: 0, token: 'tok' } };
    return fn(m, p, b);
  };

const JOB = { jobId: 'j1', orderId: 'o1', unitIndex: 0, gcodeUrl: 'x', callbackKey: 'cb', printDoneKey: 'pd', brokerWorkflowId: 'bw' };

beforeEach(() => {
  __resetHttpBackend();
  h.calls = [];
  Object.assign(process.env, {
    BAMBU_BASE_URL: 'https://mock.test:8443',
    BAMBU_CLIENT_CERT: '/c.crt',
    BAMBU_CLIENT_KEY: '/c.key',
    BAMBU_CA_CERT: '/ca.crt',
    BAMBU_SERVERNAME: 'farm_server.bambulab.com',
    BAMBU_ADMIN_USER: 'admin',
    BAMBU_ADMIN_PASS: 'qwer1234',
  });
});

describe('bambu-http — config', () => {
  it('fails loud naming missing env when http selected', async () => {
    delete process.env.BAMBU_BASE_URL;
    await expect(httpBackend.pollDevice('S1')).resolves.toMatchObject({ ok: false });
    // pollDevice swallows to transport; a command surfaces the config error:
    delete process.env.BAMBU_BASE_URL;
    await expect(httpBackend.bind('S1')).rejects.toThrow(/BAMBU_BASE_URL/);
  });
});

describe('bambu-http — login', () => {
  it('computes the triple-SHA256 password hash the SDK expects', async () => {
    h.handler = loginOr(() => ({ status: 200, json: { code: 0, bind_results: [{ device_id: 'S1', code: 0 }] } }));
    await httpBackend.bind('S1');
    const tokenCall = h.calls.find((c) => c.path === '/login/local/tokens')!;
    const sent = JSON.parse(tokenCall.body);
    expect(sent.password).toBe(sha(sha(sha('qwer1234') + 's') + 'c'));
    expect(sent.shared_client_key).toBe('bbl_third_party');
  });
});

describe('bambu-http — bind/unbind', () => {
  it('binds via PUT /sdk/device/bind with the serial', async () => {
    h.handler = loginOr(() => ({ status: 200, json: { code: 0, bind_results: [{ device_id: 'S1', code: 0 }] } }));
    await httpBackend.bind('S1');
    const bindCall = h.calls.find((c) => c.path === '/sdk/device/bind')!;
    expect(bindCall.method).toBe('PUT');
    expect(JSON.parse(bindCall.body).devices[0].device_id).toBe('S1');
  });

  it('throws when the bind result code is non-zero', async () => {
    h.handler = loginOr(() => ({ status: 200, json: { bind_results: [{ device_id: 'S1', code: 1 }] } }));
    await expect(httpBackend.bind('S1')).rejects.toBeInstanceOf(BambuHttpError);
  });
});

describe('bambu-http — pollDevice', () => {
  it('maps dev_info.report_status into a snapshot', async () => {
    h.handler = loginOr(() => ({ status: 200, json: { dev_info: { online: true, dev_model: 'C12', report_status: { gcode_state: 'RUNNING', mc_percent: 42, hms: [] } } } }));
    const res = await httpBackend.pollDevice('S1');
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.snapshot.online).toBe(true);
      expect(res.snapshot.reportStatus.gcode_state).toBe('RUNNING');
      expect(res.snapshot.reportStatus.mc_percent).toBe(42);
    }
  });

  it('reports unbound on 404 / code 1006', async () => {
    h.handler = loginOr(() => ({ status: 404, json: { code: 1006, message: 'unbinded device' } }));
    await expect(httpBackend.pollDevice('S1')).resolves.toEqual({ ok: false, error: 'unbound' });
  });

  it('reports transport (never offline) on a network error', async () => {
    h.handler = loginOr(() => ({ status: 0, networkError: true }));
    const res = await httpBackend.pollDevice('S1');
    expect(res).toMatchObject({ ok: false, error: 'transport' });
  });
});

describe('bambu-http — opt', () => {
  it('treats a 200 guard rejection as a no-op', async () => {
    h.handler = loginOr(() => ({ status: 200, json: { code: 1, message: 'cannot pause from IDLE' } }));
    await expect(httpBackend.opt('S1', 'pause')).resolves.toBeUndefined();
  });

  it('throws on a non-2xx opt response', async () => {
    h.handler = loginOr(() => ({ status: 500, json: { message: 'boom' } }));
    await expect(httpBackend.opt('S1', 'stop')).rejects.toBeInstanceOf(BambuHttpError);
  });
});

describe('bambu-http — uploadAndPrint', () => {
  it('PUTs a multipart body with print_cmd + file parts', async () => {
    h.handler = loginOr(() => ({ status: 200, json: { code: 0 } }));
    await httpBackend.uploadAndPrint('S1', JOB);
    const printCall = h.calls.find((c) => c.path === '/device/S1/print')!;
    expect(printCall.method).toBe('PUT');
    expect(printCall.body).toContain('name="print_cmd"');
    expect(printCall.body).toContain('name="file"; filename="j1.3mf"');
    expect(printCall.body).toContain('"task_name":"j1"');
  });

  it('treats code 1051 (device busy) as a no-op', async () => {
    h.handler = loginOr(() => ({ status: 200, json: { code: 1051, message: 'device busy' } }));
    await expect(httpBackend.uploadAndPrint('S1', JOB)).resolves.toBeUndefined();
  });
});
