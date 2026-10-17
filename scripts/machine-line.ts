/**
 * machine-line: drive the machine line example end to end.
 *
 * Starts unit routes on the line and plays the people: a person at line exit
 * takes the units off the last machine and receives them, a technician
 * clears alarms at the machine, and an operator decides each failed handoff.
 * The machines and the gateway do the rest over MQTT. Rows are watched on
 * Long Tail's NATS, as the gateway watches them.
 *
 * Usage (after `docker compose -f docker-compose.yml -f docker-compose.nats.yml -f docker-compose.machines.yml up -d --build`):
 *   npm run machine:line
 *   UNITS=8 BATCH=2 npm run machine:line
 *   FAULT=jam npm run machine:line               # first route jams leaving FAULT_AT; operator retries
 *   FAULT=reject DECIDE=scrap npm run machine:line
 *
 * Env vars:
 *   BASE_URL      Long Tail API (default http://localhost:3000)
 *   SIM_URL       mock line drill server (default http://localhost:8090)
 *   NATS_URL      Long Tail NATS (default nats://localhost:4222), NATS_TOKEN (default dev_api_secret)
 *   UNITS         units to run (default 6); BATCH units per route (default 2)
 *   FAULT         jam | incomplete | carrier_mismatch | unreadable | stall | reject | hold | estop | offline
 *   FAULT_AT      machine the fault happens at (default the first machine)
 *   DECIDE        operator decision on a failed handoff: retry | manual | scrap (default retry)
 *   OFFLINE_S     how long FAULT=offline keeps the machine away (default 25)
 *   HANDOFF_TIMEOUT  per-handoff timeout (default 5m); TIMEOUT_S whole run (default 300)
 */

try { require('dotenv/config'); } catch { /* dotenv optional */ }

import { connect, StringCodec } from 'nats';

import { DECISION, LINE_ROLE, ROW_TYPE } from '../examples/workflows/machine-line/contracts';
import { loadLine } from '../examples/workflows/machine-line/line';
import { MODE } from '../examples/workflows/machine-line/protocol';
import { UNIT_ROUTE_WORKFLOW, lineSteps, type UnitRouteInput } from '../examples/workflows/machine-line/workflows/route';

const env = process.env;
const BASE_URL = env.BASE_URL || 'http://localhost:3000';
const SIM_URL = env.SIM_URL || 'http://localhost:8090';
const NATS_URL = env.NATS_URL || 'nats://localhost:4222';
const NATS_TOKEN = env.NATS_TOKEN ?? 'dev_api_secret';
const UNITS = parseInt(env.UNITS || '6', 10);
const BATCH = Math.max(1, parseInt(env.BATCH || '2', 10));
const FAULT = env.FAULT || '';
const DECIDE = env.DECIDE || DECISION.RETRY;
const OFFLINE_S = parseInt(env.OFFLINE_S || '25', 10);
const HANDOFF_TIMEOUT = env.HANDOFF_TIMEOUT || '5m';
const TIMEOUT_S = parseInt(env.TIMEOUT_S || '300', 10);
const TECH = 'line-tech';

const TRANSFER_FAULTS = ['jam', 'incomplete', 'carrier_mismatch', 'unreadable', 'stall'];
const RESULT_FAULTS = ['reject', 'hold'];
const STOPPED = new Set<string>([MODE.FAULTED, MODE.EMERGENCY_STOP]);

const line = loadLine(env.MACHINE_LINE_CONFIG);
const FAULT_AT = env.FAULT_AT || line.machines[0].machineId;
const RUN = `L${Date.now().toString(36).slice(-5)}`;
const counts: Record<string, number> = {};

let token = '';
const ts = () => new Date().toISOString().slice(11, 19);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const say = (msg: string) => console.log(`[${ts()}] ${msg}`);

async function call(base: string, method: string, path: string, body?: unknown, auth = true): Promise<any> {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(auth && token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${JSON.stringify(data)}`);
  return data;
}
const api = (method: string, path: string, body?: unknown) => call(BASE_URL, method, `/api${path}`, body);
const sim = (method: string, path: string, body?: unknown) => call(SIM_URL, method, path, body, false);

// ── The physical world ───────────────────────────────────────────────────────

/** A technician clears every alarm at a machine and resets it if it stopped. */
async function fixMachine(machineId: string): Promise<void> {
  const state = await sim('GET', `/sim/${machineId}`);
  for (const alarm of state.alarms ?? []) {
    if (alarm.active) await sim('POST', `/sim/${machineId}/clear-alarm`, { alarmId: alarm.alarmId, by: TECH });
  }
  if (STOPPED.has(state.mode)) await sim('POST', `/sim/${machineId}/reset`, { by: TECH });
  if (!state.link?.connected) await sim('POST', `/sim/${machineId}/network`, { mode: 'restore' });
}

async function injectFault(): Promise<void> {
  if (!FAULT) return;
  if (TRANSFER_FAULTS.includes(FAULT)) await sim('POST', `/sim/${FAULT_AT}/transfer`, { fault: FAULT });
  else if (RESULT_FAULTS.includes(FAULT)) await sim('POST', `/sim/${FAULT_AT}/arm`, { result: FAULT, reason: `driver-${FAULT}` });
  else if (FAULT === 'estop') await sim('POST', `/sim/${FAULT_AT}/emergency-stop`);
  else if (FAULT === 'offline') {
    await sim('POST', `/sim/${FAULT_AT}/network`, { mode: 'drop' });
    setTimeout(() => void sim('POST', `/sim/${FAULT_AT}/network`, { mode: 'restore' }).then(() => say(`[floor] ${FAULT_AT} back online`)), OFFLINE_S * 1000);
  } else throw new Error(`unknown FAULT=${FAULT}`);
  say(`[floor] fault armed: ${FAULT} at ${FAULT_AT}`);
}

// ── The people ───────────────────────────────────────────────────────────────

/** A person takes units off a machine, waiting briefly for any still finishing. */
async function takeUnits(machineId: string | null, units: { unitId: string }[], tries = 40): Promise<void> {
  if (!machineId) return;
  for (const unit of units) {
    for (let i = 0; i < tries && !(await sim('POST', `/sim/${machineId}/unload`, { unitId: unit.unitId })).result; i++) await sleep(250);
  }
}

/** Line exit: take each unit off the machine it came from, then receive the set. */
async function receiveAtExit(row: Record<string, any>): Promise<void> {
  const md = row.metadata ?? {};
  await takeUnits(md.fromMachine ?? null, md.units ?? []);
  await api('POST', `/escalations/${row.id}/resolve`, { resolverPayload: { received: true, receiver: 'line-exit-person' } });
  say(`[exit]     received ${(md.units ?? []).map((u: any) => u.unitId).join(', ')} from ${md.fromMachine ?? 'entry'}`);
}

/** Operator: make the machines healthy, then decide the failed handoff. */
async function decideFailure(row: Record<string, any>): Promise<void> {
  const md = row.metadata ?? {};
  for (const m of line.machines) await fixMachine(m.machineId);
  if (DECIDE === DECISION.SCRAP) await takeUnits(md.fromMachine ?? null, md.units ?? [], 4);
  await api('POST', `/escalations/${row.id}/resolve`, { resolverPayload: { decision: DECIDE, note: `driver: ${md.errorCode}` } });
  say(`[operator] ${md.jobId} ${md.errorCode} at ${md.fromMachine ?? 'entry'} -> ${DECIDE}`);
}

async function onRow(row: Record<string, any>): Promise<void> {
  const md = row.metadata ?? {};
  if (md.siteId !== line.siteId || md.lineId !== line.lineId) return;
  counts[row.type] = (counts[row.type] ?? 0) + 1;
  if (row.type === ROW_TYPE.HANDOFF && row.role === LINE_ROLE.EXIT && String(md.jobId ?? '').startsWith(RUN)) return receiveAtExit(row);
  if (row.type === ROW_TYPE.HANDOFF_ERROR && String(md.jobId ?? '').startsWith(RUN)) return decideFailure(row);
  if (row.type === ROW_TYPE.ALARM) {
    say(`[tech]     alarm ${md.code ?? ''} at ${md.machineId}: fixing`);
    await sleep(1500);
    if (md.machineId) await fixMachine(md.machineId);
    return;
  }
  say(`[row]      ${row.type} ${row.description ?? ''}`);
}

// ── The run ──────────────────────────────────────────────────────────────────

async function startRoutes(artifact: { url: string; sha256: string }): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0, n = 0; n < UNITS; i++) {
    const routeKey = `${RUN}-R${i + 1}`;
    const units = Array.from({ length: Math.min(BATCH, UNITS - n) }, (_, j) => ({ unitId: `${routeKey}-U${j + 1}`, carrierId: `CR-${routeKey}-${j + 1}` }));
    n += units.length;
    const data: UnitRouteInput = {
      siteId: line.siteId, lineId: line.lineId, routeKey, orderRef: `ORD-${RUN}`, units, steps: lineSteps(line), artifact, handoffTimeout: HANDOFF_TIMEOUT,
    };
    const workflowId = `mur-${routeKey}`;
    await api('POST', `/workflows/${UNIT_ROUTE_WORKFLOW}/invoke`, { workflowId, data, metadata: { source: 'machine-line' } });
    ids.push(workflowId);
    say(`[route]    ${routeKey}: ${units.map((u) => u.unitId).join(', ')}`);
  }
  return ids;
}

async function awaitResults(ids: string[]): Promise<Map<string, any>> {
  const results = new Map<string, any>();
  const deadline = Date.now() + TIMEOUT_S * 1000;
  while (results.size < ids.length && Date.now() < deadline) {
    await sleep(1000);
    for (const id of ids.filter((x) => !results.has(x))) {
      const resp = await api('GET', `/workflows/${id}/result`).catch(() => null);
      if (resp?.result?.data?.status) results.set(id, resp.result.data);
    }
  }
  return results;
}

function report(ids: string[], results: Map<string, any>): boolean {
  console.log('\nroute                    status     hops');
  let ok = true;
  for (const id of ids) {
    const data = results.get(id);
    if (data?.status !== 'complete') ok = false;
    const hops = (data?.history ?? []).map((h: any) => `${h.to}${h.received ? '' : `(${h.errorCode})`}`).join(' > ');
    console.log(`${id.padEnd(24)} ${(data?.status ?? 'timed out').padEnd(10)} ${hops}`);
  }
  console.log(`\nrows seen: ${Object.entries(counts).map(([k, v]) => `${k}=${v}`).join('  ') || 'none'}`);
  return ok;
}

async function main(): Promise<void> {
  // 1. Log in, check the mock line is this line
  token = (await call(BASE_URL, 'POST', '/api/auth/login', { username: 'superadmin', password: 'l0ngt@1l' }, false)).token;
  const state = await sim('GET', '/sim/state');
  if (state.siteId !== line.siteId || state.lineId !== line.lineId) throw new Error(`mock runs ${state.siteId}/${state.lineId}, driver expects ${line.siteId}/${line.lineId}`);
  for (const m of line.machines) {
    await sim('POST', `/sim/${m.machineId}/disarm`);
    await fixMachine(m.machineId);
  }

  // 2. Watch the rows people act on, one at a time
  const nc = await connect({ servers: NATS_URL, token: NATS_TOKEN || undefined, name: 'machine-line-driver' });
  const sc = StringCodec();
  let chain = Promise.resolve();
  for (const role of [LINE_ROLE.EXIT, LINE_ROLE.OPERATOR]) {
    nc.subscribe(`lt.events.system.escalation.${role}.*.created`, {
      callback: (_err, m) => {
        const row = JSON.parse(sc.decode(m.data)).data ?? {};
        chain = chain.then(() => onRow(row)).catch((err) => say(`[driver]   ${err.message}`));
      },
    });
  }

  // 3. A job artifact, the fault, and the routes
  const artifact = await sim('POST', '/payloads', `machine-line ${RUN}`);
  await injectFault();
  const ids = await startRoutes({ url: artifact.url, sha256: artifact.sha256 });

  // 4. Wait for every route, then report
  const results = await awaitResults(ids);
  await chain;
  await nc.drain();
  const ok = report(ids, results);
  process.exit(ok || (FAULT && DECIDE !== DECISION.RETRY) ? 0 : 1);
}

main().catch((err) => {
  console.error(`[${ts()}] failed: ${err.message}`);
  process.exit(1);
});
