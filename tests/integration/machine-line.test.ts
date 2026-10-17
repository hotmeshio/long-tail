/**
 * The factory line through the public API, against the machines override:
 *   docker compose -f docker-compose.yml -f docker-compose.nats.yml -f docker-compose.machines.yml up -d --build
 *   MACHINE_SIM_URL=http://localhost:8090 npm run test:integration:skip-reset -- machine-line
 *
 * Unit routes from both manifests run on the real orchestrator; the gateway
 * dispatches over the machine broker and resolves each machine handoff as
 * the machine's bot; the test plays the people and the operator.
 */

import { describe, it, expect, beforeAll } from 'vitest';

import { UNIT_ROUTE_WORKFLOW, type RouteStep } from '../../examples/workflows/machine-line/workflows/route';
import { loadLine } from '../../examples/workflows/machine-line/line';
import { FACTORY_LINE_PATH, loadManifests, manifestSteps } from '../../examples/workflows/machine-line/manifests';
import { exitRole, machineById } from '../../lib/machines/line';
import { MACHINE_COMMAND_WORKFLOW } from '../../examples/workflows/machine-line';
import { commandTarget, type CommandTarget } from '../../services/machines/commands';

const BASE_URL = process.env.LT_BASE_URL || 'http://localhost:3000';
const LINE = loadLine(FACTORY_LINE_PATH);
const MANIFESTS = loadManifests();
const AUTOMATED = manifestSteps(LINE, MANIFESTS.automated);
const MANUAL = manifestSteps(LINE, MANIFESTS.manual);
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

async function start(routeKey: string, unitIds: string[], steps: RouteStep[] = AUTOMATED): Promise<string> {
  const workflowId = `mur-${routeKey}`;
  await api(`/workflows/${UNIT_ROUTE_WORKFLOW}/invoke`, 'POST', {
    workflowId,
    data: {
      siteId: LINE.siteId, lineId: LINE.lineId, routeKey, orderRef: `ORD-${routeKey}`, exitRole: exitRole(LINE),
      units: unitIds.map((unitId) => ({ unitId, carrierId: `CR-${unitId}` })), steps, handoffTimeout: '3m',
    },
  });
  return workflowId;
}

/** Ask a machine for a command through the machineCommand workflow; resolves with the machine's reply. */
async function command(target: CommandTarget, op: string, args: Record<string, unknown> = {}): Promise<any> {
  const requestKey = `IT${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const workflowId = `mc-${requestKey}`;
  await api(`/workflows/${MACHINE_COMMAND_WORKFLOW}/invoke`, 'POST', { workflowId, data: { ...target, requestKey, op, args } });
  return result(workflowId, 60_000);
}

/** A person at a station: wait for the sender's release of each unit, take the units off, receive them. */
async function receive(jobId: string, unitIds: string[], ms = 60_000): Promise<void> {
  const [row] = await rowsFor(jobId, (rows) => rows.some((r) => r.status === 'pending'), ms);
  const from = row.metadata.fromMachine;
  if (from) {
    await until(async () => {
      const { items = [] } = await api(`/escalations/${row.id}/items`);
      return unitIds.every((u) => items.some((i: any) => i.itemKey === `released:${u}`));
    });
    for (const unitId of unitIds) expect((await sim(`/sim/${from}/unload`, 'POST', { unitId })).result).toBe(true);
  }
  await api(`/escalations/${row.id}/resolve`, 'POST', { resolverPayload: { received: true, receiver: 'integration-test' } });
}

async function until(check: () => Promise<boolean>, ms = 90_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error('condition not met in time');
    await sleep(500);
  }
}

describe.skipIf(!SIM_URL)('machine line over the site broker', () => {
  beforeAll(async () => {
    token = (await call(`${BASE_URL}/api/auth/login`, 'POST', { username: 'superadmin', password: 'l0ngt@1l' }, false)).token;
  });

  it('automated: two units ride the machines; each resolves its own handoff as its bot; a person receives them', async () => {
    const routeKey = `IT${Date.now().toString(36)}`;
    const units = [`${routeKey}-A`, `${routeKey}-B`];
    const id = await start(routeKey, units);
    await receive(`${routeKey}-exit`, units);
    const data = await result(id, 180_000);
    expect(data.status).toBe('complete');
    expect(data.history.map((h: any) => h.to)).toEqual(['print-01', 'convey-01', 'press-01', 'cut-01', 'inspect-01', 'exit']);

    const [intoCut] = await rowsFor(`${routeKey}-cut-01`, (rows) => rows.some((r) => r.status === 'resolved'));
    const bots = await api('/bot-accounts?search=machine-site-1-line-1-cut-01&limit=5');
    const cutBot = bots.bots.find((b: any) => b.external_id === 'machine-site-1-line-1-cut-01');
    const payload = typeof intoCut.resolver_payload === 'string' ? JSON.parse(intoCut.resolver_payload) : intoCut.resolver_payload;
    expect(intoCut.assigned_to).toBe(cutBot.id);
    expect(intoCut.metadata.resolved_by).toBe(cutBot.id);
    expect(payload).toMatchObject({ received: true });

    // The bonder's lots ride on the row into the cutter: a search by lot finds this route.
    expect(intoCut.metadata.lots).toEqual(['L-1001', 'L-1002']);
    const facets = encodeURIComponent(JSON.stringify({ lots: ['L-1001'], orderRef: `ORD-${routeKey}` }));
    const byLot = await api(`/escalations?facets=${facets}&limit=20`);
    expect(byLot.escalations.map((r: any) => r.id)).toEqual([intoCut.id]);
  }, 240_000);

  it('a machine-command row pauses and resumes a machine, and a changeover to a version it lacks comes back refused', async () => {
    const target = commandTarget(LINE, 'convey-01');
    expect(await command(target, 'pause')).toMatchObject({ accepted: true, machineId: 'convey-01', op: 'pause' });
    expect((await sim('/sim/convey-01')).enabled).toBe(false);
    expect(await command(target, 'resume')).toMatchObject({ accepted: true, op: 'resume' });
    expect((await sim('/sim/convey-01')).enabled).toBe(true);
    const refused = await command(target, 'changeover', { recipe: { id: 'RCP-NONE', version: '1' } });
    expect(refused).toMatchObject({ accepted: false, status: 'refused' });
  }, 120_000);

  it('pacing: a paused print cell is sent no more than its queue depth; the rest wait, then every route completes', async () => {
    const print = commandTarget(LINE, 'print-01');
    const depth = machineById(LINE, 'print-01').queueDepth!;
    expect(await command(print, 'pause')).toMatchObject({ accepted: true });
    const base = `IT${Date.now().toString(36)}`;
    const keys = Array.from({ length: depth + 2 }, (_, i) => `${base}x${i}`);
    const ids: string[] = [];
    for (const key of keys) ids.push(await start(key, [`${key}-A`]));
    const intoPrint = async () => Promise.all(keys.map(async (key) => (await rowsFor(`${key}-print-01`, (rows) => rows.length > 0))[0]));
    await until(async () => (await intoPrint()).filter((r) => r.assigned_to).length >= depth, 60_000);
    await sleep(3_000);
    const rows = await intoPrint();
    expect(rows.filter((r) => r.assigned_to)).toHaveLength(depth);
    expect(rows.filter((r) => !r.assigned_to && r.status === 'pending')).toHaveLength(2);
    expect(await command(print, 'resume')).toMatchObject({ accepted: true });
    await Promise.all(keys.map((key) => receive(`${key}-exit`, [`${key}-A`], 300_000)));
    for (const id of ids) expect((await result(id, 120_000)).status).toBe('complete');
  }, 480_000);

  it('manual: the same workflow through people at each station, received at the same inspector', async () => {
    const routeKey = `IT${Date.now().toString(36)}`;
    const units = [`${routeKey}-M`];
    const id = await start(routeKey, units, MANUAL);
    for (const station of ['harvester', 'bonder', 'finisher', 'exit']) await receive(`${routeKey}-${station}`, units);
    const data = await result(id, 180_000);
    expect(data.status).toBe('complete');
    expect(data.history.map((h: any) => [h.to, h.received])).toEqual([['print-02', true], ['harvester', true], ['bonder', true], ['finisher', true], ['exit', true]]);
  }, 240_000);

  it('a jam parks an operator row; after the technician clears it, retry completes the route', async () => {
    const routeKey = `IT${Date.now().toString(36)}`;
    // Spent on the next move involving cut-01: press-01 → cut-01, which jams leaving press-01.
    await sim('/sim/cut-01/transfer', 'POST', { fault: 'jam' });
    const id = await start(routeKey, [`${routeKey}-J`]);
    const [decide] = await rowsFor(`${routeKey}-cut-01`, (rows) => rows.some((r) => r.type === 'handoff-error' && r.status === 'pending'), 180_000);
    const press = await sim('/sim/press-01');
    for (const alarm of press.alarms.filter((a: any) => a.active)) await sim('/sim/press-01/clear-alarm', 'POST', { alarmId: alarm.alarmId, by: 'tech' });
    await api(`/escalations/${decide.id}/resolve`, 'POST', { resolverPayload: { decision: 'retry', note: 'cleared' } });
    await receive(`${routeKey}-exit`, [`${routeKey}-J`]);
    const data = await result(id, 180_000);
    expect(data.status).toBe('complete');
    expect(data.history.filter((h: any) => h.to === 'cut-01').map((h: any) => [h.attempt, h.received, h.errorCode])).toEqual([[1, false, 'jam'], [2, true, undefined]]);
  }, 240_000);
});
