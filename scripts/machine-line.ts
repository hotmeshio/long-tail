/**
 * machine-line: drive the machine line example end to end.
 *
 * Starts unit routes on the factory line and plays the people: at every
 * station people work (and at the inspector, where every route ends) a
 * person takes the units off the station before and receives them; a
 * technician clears alarms; an operator decides each failed handoff. The
 * machines and the gateway do the rest over MQTT. MIX sets the share of
 * routes minted from the automated manifest; the rest run the manual one,
 * through the same workflow. Rows are watched on Long Tail's NATS.
 *
 * Usage (after `docker compose -f docker-compose.yml -f docker-compose.nats.yml -f docker-compose.machines.yml up -d --build`):
 *   npm run machine:line
 *   MIX=50 UNITS=8 npm run machine:line          # half automated, half manual, same factory
 *   UNITS=8 BATCH=2 npm run machine:line
 *   FAULT=jam npm run machine:line               # first route jams leaving FAULT_AT; operator retries
 *   FAULT=reject DECIDE=scrap npm run machine:line
 *
 * Env vars:
 *   BASE_URL      Long Tail API (default http://localhost:3000)
 *   SIM_URL       mock line drill server (default http://localhost:8090)
 *   NATS_URL      Long Tail NATS (default nats://localhost:4222), NATS_TOKEN (default dev_api_secret)
 *   UNITS         units to run (default 6); BATCH units per route (default 2)
 *   MIX           percent of routes on the automated manifest (default 100); the rest run manual
 *   MACHINE_LINE_CONFIG, MACHINE_MANIFESTS   line and manifests (default the factory line and route-manifests.json)
 *   FAULT         jam | incomplete | carrier_mismatch | unreadable | stall | reject | hold | estop | offline
 *   FAULT_AT      machine the fault happens at (default the first machine)
 *   DECIDE        operator decision on a failed handoff: retry | manual | scrap (default retry;
 *                 manual where the row does not offer retry)
 *   OFFLINE_S     how long FAULT=offline keeps the machine away (default 25)
 *   HANDOFF_TIMEOUT  per-handoff timeout (default 5m); TIMEOUT_S whole run (default 300)
 */

try { require('dotenv/config'); } catch { /* dotenv optional */ }

import { connect, StringCodec } from 'nats';

import { DECISION, ROW_TYPE } from '../services/machines/contracts';
import { exitRole, stationRoles } from '../lib/machines/line';
import { FACTORY_LINE_PATH, automatedAt, loadManifests, manifestSteps } from '../examples/workflows/machine-line/manifests';
import { loadLine } from '../examples/workflows/machine-line/line';
import { MODE } from '../lib/machines/protocol';
import { UNIT_ROUTE_WORKFLOW, type UnitRouteInput } from '../examples/workflows/machine-line/workflows/route';

const env = process.env;
const BASE_URL = env.BASE_URL || 'http://localhost:3000';
const SIM_URL = env.SIM_URL || 'http://localhost:8090';
const NATS_URL = env.NATS_URL || 'nats://localhost:4222';
const NATS_TOKEN = env.NATS_TOKEN ?? 'dev_api_secret';
const UNITS = parseInt(env.UNITS || '6', 10);
const BATCH = Math.max(1, parseInt(env.BATCH || '2', 10));
const MIX = parseInt(env.MIX || '100', 10);
const FAULT = env.FAULT || '';
const DECIDE = env.DECIDE || DECISION.RETRY;
const OFFLINE_S = parseInt(env.OFFLINE_S || '25', 10);
const HANDOFF_TIMEOUT = env.HANDOFF_TIMEOUT || '5m';
const TIMEOUT_S = parseInt(env.TIMEOUT_S || '300', 10);
const TECH = 'line-tech';

const TRANSFER_FAULTS = ['jam', 'incomplete', 'carrier_mismatch', 'unreadable', 'stall'];
const RESULT_FAULTS = ['reject', 'hold'];
const STOPPED = new Set<string>([MODE.FAULTED, MODE.EMERGENCY_STOP]);

const line = loadLine(env.MACHINE_LINE_CONFIG || FACTORY_LINE_PATH);
const manifests = loadManifests(env.MACHINE_MANIFESTS || undefined);
const MANIFEST = { AUTOMATED: 'automated', MANUAL: 'manual' } as const;
const machineRoles = new Set(stationRoles(line));
const firstMachine = manifests[MANIFEST.AUTOMATED].steps.find((s) => typeof s === 'string') as string;
const FAULT_AT = env.FAULT_AT || firstMachine;
const manifestOf = new Map<string, string>();
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

/** A person takes units off a machine; false when a unit was not there to take. */
async function takeUnits(machineId: string | null, units: { unitId: string }[], tries = 40): Promise<boolean> {
  if (!machineId) return true;
  let all = true;
  for (const unit of units) {
    let taken = false;
    for (let i = 0; i < tries && !(taken = (await sim('POST', `/sim/${machineId}/unload`, { unitId: unit.unitId })).result); i++) await sleep(250);
    all &&= taken;
  }
  return all;
}

/** Wait until the row holds the sender's release of every unit: the machine has finished them. */
async function released(rowId: string, units: { unitId: string }[], ms = 180_000): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const { items = [] } = await api('GET', `/escalations/${rowId}/items`);
    const keys = new Set(items.map((i: any) => i.itemKey));
    if (units.every((u) => keys.has(`released:${u.unitId}`))) return true;
    await sleep(500);
  }
  return false;
}

/** Units the operator sent off the line by hand: the sender already finished them, so no release is coming. */
const takenOver = new Set<string>();

/**
 * A person at a station: take each unit off the machine it came from (if any),
 * or collect it where a split left it (a pickup row), then receive the set.
 */
async function receive(row: Record<string, any>): Promise<void> {
  const md = row.metadata ?? {};
  const units = md.units ?? [];
  const at: string | null = md.pickupAt ?? md.fromMachine ?? null;
  const finished = async () => !!md.pickupAt || units.every((u: any) => takenOver.has(u.unitId)) || released(row.id, units);
  if (at && !(await finished() && await takeUnits(at, units))) {
    say(`[${row.role}]`.padEnd(11) + ` ${units.map((u: any) => u.unitId).join(', ')} never left ${at}; leaving the row open`);
    return;
  }
  await api('POST', `/escalations/${row.id}/resolve`, { resolverPayload: { received: true, receiver: `${row.role}-person` } });
  say(`[${row.role}]`.padEnd(11) + ` received ${units.map((u: any) => u.unitId).join(', ')} ${md.pickupAt ? `collected at ${at}` : `from ${at ?? 'a person'}`}`);
}

/** Set once a route left the line on purpose (manual or scrap), so an incomplete run is expected. */
let offLine = false;

/** Operator: make the machines healthy, then decide the failed handoff; retry falls back to manual where the row does not offer it. */
async function decideFailure(row: Record<string, any>): Promise<void> {
  const md = row.metadata ?? {};
  for (const m of line.machines) await fixMachine(m.machineId);
  const allowed: string[] = md.decisions ?? [DECIDE];
  const decision = allowed.includes(DECIDE) ? DECIDE : allowed[0];
  if (decision !== DECISION.RETRY) offLine = true;
  if (decision === DECISION.MANUAL) for (const u of md.units ?? []) takenOver.add(u.unitId);
  if (decision === DECISION.SCRAP) await takeUnits(md.fromMachine ?? null, md.units ?? [], 4);
  await api('POST', `/escalations/${row.id}/resolve`, { resolverPayload: { decision, note: `driver: ${md.errorCode}` } });
  // Scrapped units split by a partial arrival: the ones that arrived wait at the receiver once the workflow stops its job.
  if (decision === DECISION.SCRAP && md.errorCode === 'partial-arrival') await takeUnits(md.toMachine ?? null, md.units ?? [], 8);
  say(`[operator] ${md.jobId} ${md.errorCode} at ${md.fromMachine ?? 'entry'} -> ${decision}`);
}

async function onRow(row: Record<string, any>): Promise<void> {
  const md = row.metadata ?? {};
  if (md.siteId !== line.siteId || md.lineId !== line.lineId) return;
  counts[row.type] = (counts[row.type] ?? 0) + 1;
  if (row.type === ROW_TYPE.HANDOFF && !machineRoles.has(row.role) && String(md.jobId ?? '').startsWith(RUN)) {
    // Each person works their own station; a slow one does not hold up the rest.
    void receive(row).catch((err) => say(`[driver]   ${err.message}`));
    return;
  }
  if (row.type === ROW_TYPE.HANDOFF) return;
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
    const name = automatedAt(i, MIX) ? MANIFEST.AUTOMATED : MANIFEST.MANUAL;
    const data: UnitRouteInput = {
      siteId: line.siteId, lineId: line.lineId, routeKey, orderRef: `ORD-${RUN}`, units,
      steps: manifestSteps(line, manifests[name]), exitRole: exitRole(line), artifact, handoffTimeout: HANDOFF_TIMEOUT,
    };
    const workflowId = `mur-${routeKey}`;
    await api('POST', `/workflows/${UNIT_ROUTE_WORKFLOW}/invoke`, { workflowId, data, metadata: { source: 'machine-line', manifest: name } });
    ids.push(workflowId);
    manifestOf.set(workflowId, name);
    say(`[route]    ${routeKey} (${name}): ${units.map((u) => u.unitId).join(', ')}`);
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
  console.log('\nroute                    manifest   status     hops');
  let ok = true;
  const byManifest: Record<string, { routes: number; complete: number; atInspector: number }> = {};
  for (const id of ids) {
    const data = results.get(id);
    const name = manifestOf.get(id)!;
    const tally = (byManifest[name] ??= { routes: 0, complete: 0, atInspector: 0 });
    tally.routes++;
    if (data?.status === 'complete') tally.complete++;
    else ok = false;
    const last = data?.history?.[data.history.length - 1];
    if (last?.to === 'exit' && last.received) tally.atInspector++;
    const hops = (data?.history ?? []).map((h: any) => `${h.to}${h.received ? '' : `(${h.errorCode})`}`).join(' > ');
    console.log(`${id.padEnd(24)} ${name.padEnd(10)} ${(data?.status ?? 'timed out').padEnd(10)} ${hops}`);
  }
  console.log('');
  for (const [name, t] of Object.entries(byManifest)) {
    console.log(`${name.padEnd(10)} ${t.complete}/${t.routes} complete, ${t.atInspector} received at ${exitRole(line)}`);
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
  nc.subscribe('lt.events.system.escalation.*.*.created', {
    callback: (_err, m) => {
      const row = JSON.parse(sc.decode(m.data)).data ?? {};
      chain = chain.then(() => onRow(row)).catch((err) => say(`[driver]   ${err.message}`));
    },
  });

  // 3. A job artifact, the fault, and the routes
  const artifact = await sim('POST', '/payloads', `machine-line ${RUN}`);
  await injectFault();
  const ids = await startRoutes({ url: artifact.url, sha256: artifact.sha256 });

  // 4. Wait for every route, then report
  const results = await awaitResults(ids);
  await chain;
  await nc.drain();
  const ok = report(ids, results);
  process.exit(ok || offLine ? 0 : 1);
}

main().catch((err) => {
  console.error(`[${ts()}] failed: ${err.message}`);
  process.exit(1);
});
