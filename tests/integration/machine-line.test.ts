/**
 * The machine line through the public API, against the machines override:
 *   docker compose -f docker-compose.yml -f docker-compose.nats.yml -f docker-compose.machines.yml up -d --build
 *   MACHINE_SIM_URL=http://localhost:8090 npm run test:integration:skip-reset -- machine-line
 *
 * A unit route runs on the real orchestrator; the gateway dispatches over the
 * site broker and resolves each handoff as the machine's bot; the test plays
 * the person at line exit and the operator.
 */

import { describe, it, expect, beforeAll } from 'vitest';

import { lineSteps, UNIT_ROUTE_WORKFLOW } from '../../examples/workflows/machine-line/workflows/route';
import { DEFAULT_LINE } from '../../examples/workflows/machine-line/line';

const BASE_URL = process.env.LT_BASE_URL || 'http://localhost:3000';
const SIM_URL = process.env.MACHINE_SIM_URL;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let token = '';

async function call(url: string, method = 'GET', body?: unknown, auth = true): Promise<any> {
  const res = await fetch(url, {
    method,
    headers: { 'content-type': 'application/json', ...(auth && token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${url} -> ${res.status}: ${JSON.stringify(data)}`);
  return data;
}
const api = (path: string, method?: string, body?: unknown) => call(`${BASE_URL}/api${path}`, method, body);
const sim = (path: string, method?: string, body?: unknown) => call(`${SIM_URL}${path}`, method, body, false);

/** The rows for one job id, waiting until `match` holds. */
async function rowsFor(jobId: string, match: (rows: any[]) => boolean, ms = 60_000): Promise<any[]> {
  const deadline = Date.now() + ms;
  for (;;) {
    const page = await api(`/escalations/by-metadata?key=jobId&value=${encodeURIComponent(jobId)}&limit=20`);
    const rows = page.escalations ?? [];
    if (match(rows)) return rows;
    if (Date.now() > deadline) throw new Error(`rows for ${jobId}: ${JSON.stringify(rows.map((r: any) => r.status))}`);
    await sleep(500);
  }
}

async function result(workflowId: string, ms = 90_000): Promise<any> {
  const deadline = Date.now() + ms;
  for (;;) {
    const resp = await api(`/workflows/${workflowId}/result`).catch(() => null);
    if (resp?.result?.data?.status) return resp.result.data;
    if (Date.now() > deadline) throw new Error(`no result for ${workflowId}`);
    await sleep(1000);
  }
}

async function start(routeKey: string, unitIds: string[]): Promise<string> {
  const workflowId = `mur-${routeKey}`;
  await api(`/workflows/${UNIT_ROUTE_WORKFLOW}/invoke`, 'POST', {
    workflowId,
    data: {
      siteId: DEFAULT_LINE.siteId, lineId: DEFAULT_LINE.lineId, routeKey, orderRef: `ORD-${routeKey}`,
      units: unitIds.map((unitId) => ({ unitId, carrierId: `CR-${unitId}` })), steps: lineSteps(DEFAULT_LINE), handoffTimeout: '3m',
    },
  });
  return workflowId;
}

async function receiveAtExit(routeKey: string, unitIds: string[]): Promise<void> {
  const [exit] = await rowsFor(`${routeKey}-exit`, (rows) => rows.some((r) => r.status === 'pending'));
  const last = DEFAULT_LINE.machines[DEFAULT_LINE.machines.length - 1].machineId;
  for (const unitId of unitIds) {
    for (let i = 0; i < 40 && !(await sim(`/sim/${last}/unload`, 'POST', { unitId })).result; i++) await sleep(250);
  }
  await api(`/escalations/${exit.id}/resolve`, 'POST', { resolverPayload: { received: true, receiver: 'integration-test' } });
}

describe.skipIf(!SIM_URL)('machine line over the site broker', () => {
  beforeAll(async () => {
    token = (await call(`${BASE_URL}/api/auth/login`, 'POST', { username: 'superadmin', password: 'l0ngt@1l' }, false)).token;
  });

  it('two units ride the line; each machine resolves its own handoff as its bot; a person receives them', async () => {
    const routeKey = `IT${Date.now().toString(36)}`;
    const id = await start(routeKey, [`${routeKey}-A`, `${routeKey}-B`]);
    await receiveAtExit(routeKey, [`${routeKey}-A`, `${routeKey}-B`]);
    const data = await result(id);
    expect(data.status).toBe('complete');
    expect(data.history.map((h: any) => h.to)).toEqual(['press-01', 'cut-01', 'inspect-01', 'exit']);

    const [intoCut] = await rowsFor(`${routeKey}-cut-01`, (rows) => rows.some((r) => r.status === 'resolved'));
    const bots = await api('/bot-accounts?search=machine-site-1-line-1-cut-01&limit=5');
    const cutBot = bots.bots.find((b: any) => b.external_id === 'machine-site-1-line-1-cut-01');
    const payload = typeof intoCut.resolver_payload === 'string' ? JSON.parse(intoCut.resolver_payload) : intoCut.resolver_payload;
    expect(intoCut.assigned_to).toBe(cutBot.id);
    expect(intoCut.metadata.resolved_by).toBe(cutBot.id);
    expect(payload).toMatchObject({ received: true });
  }, 120_000);

  it('a jam parks an operator row; after the technician clears it, retry completes the route', async () => {
    const routeKey = `IT${Date.now().toString(36)}`;
    await sim('/sim/press-01/transfer', 'POST', { fault: 'jam' });
    const id = await start(routeKey, [`${routeKey}-J`]);
    const [decide] = await rowsFor(`${routeKey}-cut-01`, (rows) => rows.some((r) => r.type === 'handoff-error' && r.status === 'pending'));
    const press = await sim('/sim/press-01');
    for (const alarm of press.alarms.filter((a: any) => a.active)) await sim('/sim/press-01/clear-alarm', 'POST', { alarmId: alarm.alarmId, by: 'tech' });
    await api(`/escalations/${decide.id}/resolve`, 'POST', { resolverPayload: { decision: 'retry', note: 'cleared' } });
    await receiveAtExit(routeKey, [`${routeKey}-J`]);
    const data = await result(id);
    expect(data.status).toBe('complete');
    expect(data.history.filter((h: any) => h.to === 'cut-01').map((h: any) => [h.attempt, h.received, h.errorCode])).toEqual([[1, false, 'jam'], [2, true, undefined]]);
  }, 120_000);
});
