/**
 * twin-farm — drive the printer-twin example end to end, effortlessly.
 *
 * Spins up the whole DIGITAL side of the physical/digital twin farm from one
 * command and plays every human part automatically, so a single run exercises
 * the full lifecycle: register → advertise → dispatch → print → settle, plus the
 * failure detour (cancel → service → back in the pool). The PHYSICAL side is the
 * app's farm-manager backend — `mock` by default (self-contained), or `http`
 * against a real print-farm-manager host once you wire the office up.
 *
 * Usage:
 *   npm run twin:farm
 *   FLEET=6 ORDERS=10 UNITS=2 npm run twin:farm
 *   FAIL_PCT=25 npm run twin:farm                 # rehearse dead-machine → service
 *   FARM_MANAGER_URL=http://192.168.1.50:4000 npm run twin:farm   # preflight the office link
 *   FLEET=4 ORDERS=4 KEEP=1 npm run twin:farm     # leave twins running to poke in the UI
 *
 * Env vars:
 *   BASE_URL          long-tail API (default http://localhost:3000)
 *   FLEET             printer twins to launch (default 4)
 *   ORDERS            orders to place (default 6)
 *   UNITS             max units per order (default 2; capped to the fleet that
 *                     shares an order's filament, so every order is satisfiable)
 *   FILAMENTS         comma-separated filament pool the fleet + orders draw from
 *                     (default "pla,petg")
 *   ARRIVAL_S         average seconds between order arrivals (default 2)
 *   FAIL_PCT          percent of print jobs to cancel mid-print, exercising the
 *                     service path (default 0). Best-effort: it races the
 *                     physical side, so raise MOCK_PRINT_SECONDS on the app for
 *                     a wider window (see README).
 *   POLL_MS           poll interval ms (default 750)
 *   BROKER_IDLE       idle broker ticks before it self-terminates (default 40)
 *   RUN_BROKER        launch a broker (default 1; set 0 if one already runs)
 *   KEEP              1 = leave twins advertising at the end (default 0 = retire
 *                     them with a power-down so nothing lingers between runs)
 *   FARM_MANAGER_URL  optional: GET this before running and report reachability,
 *                     a preflight for the office laptop → farm-manager-host link
 *
 * Capabilities: each twin is registered with a capability profile (xl/pdac/soft).
 * By default the fleet is fully capable and only filament routes; set FLEET_CAPS
 * to vary it (e.g. "xl,soft|pdac|full|full" — one spec per printer, pipe-separated,
 * each a comma list of capabilities or "full"/"base"). Orders only ever require a
 * capability the fleet can satisfy for the chosen filament and unit count.
 */

try { require('dotenv/config'); } catch { /* dotenv optional */ }

const BASE_URL     = process.env.BASE_URL || 'http://localhost:3000';
const FLEET        = parseInt(process.env.FLEET  || '4', 10);
const ORDERS       = parseInt(process.env.ORDERS || '6', 10);
const UNITS        = parseInt(process.env.UNITS  || '2', 10);
const FILAMENTS    = (process.env.FILAMENTS || 'pla,petg').split(',').map((f) => f.trim()).filter(Boolean);
const ARRIVAL_S    = parseFloat(process.env.ARRIVAL_S || '2');
const FAIL_PCT     = parseInt(process.env.FAIL_PCT || '0', 10);
const POLL_MS      = parseInt(process.env.POLL_MS || '750', 10);
const BROKER_IDLE  = parseInt(process.env.BROKER_IDLE || '40', 10);
const RUN_BROKER   = process.env.RUN_BROKER !== '0';
const KEEP         = process.env.KEEP === '1';
const FARM_MANAGER_URL = process.env.FARM_MANAGER_URL || '';

const CAPABILITY_KEYS = ['xl', 'pdac', 'soft'] as const;
type CapabilityKey = (typeof CAPABILITY_KEYS)[number];
type CapabilitySet = Record<CapabilityKey, boolean>;

const MODELS = ['Fab-X1', 'Fab-X1C', 'Fab-P2', 'Fab-Mini'];

let token = '';
let userId = '';
let done = false;

const stats = { registered: 0, dispatched: 0, printed: 0, cancelled: 0, serviced: 0, settled: 0 };

function ts(): string { return new Date().toISOString().slice(11, 19); }
function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }
function ageSeconds(iso: string): number { return (Date.now() - new Date(iso).getTime()) / 1000; }

// Deterministic per-item jitter — FNV-1a hash of a key into [0, 1). Stable
// across polls, so a job's fail/no-fail verdict never flip-flops mid-run.
function jitter(key: string, salt = ''): number {
  let h = 2166136261;
  for (const c of salt + key) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 1000) / 1000;
}
function spread(base: number, r: number): number { return base * (0.4 + 1.2 * r); }

// ── HTTP + auth (mirrors ortho-populate) ──────────────────────────────────────

async function api(method: string, path: string, body?: unknown): Promise<any> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${JSON.stringify(data)}`);
  return data;
}

async function login(): Promise<void> {
  const auth = await api('POST', '/api/auth/login', { username: 'superadmin', password: 'l0ngt@1l' });
  token = auth.token;
  userId = auth.user?.id || '';
  if (!token) { console.error('[auth] Login failed'); process.exit(1); }
  console.log(`[${ts()}] Logged in (userId ${userId.slice(0, 8)}…)`);
}

// ── Pace Board role config (idempotent — never clobbers admin tuning) ─────────

/**
 * Ensure the twin farm's roles are operationalized on the Pace Board. The
 * startup seeder (examples/seed-twin.ts) normally owns this; the driver repeats
 * it so `npm run twin:farm` populates the board even against an app that did not
 * seed the examples. Only UNCONFIGURED roles (no title) are touched — a role an
 * admin has tuned keeps its dials.
 *
 * Topology: print-jobs ─▶ printer-fleet  (production line), with print-servicer
 * a side-quest root merging into the fleet.
 */
const TWIN_ROLE_CONFIG = [
  { role: 'print-jobs',     title: 'Print Jobs',     parent_role: null,          sla_minutes: 5,  target_per_hour: 30, priority_threshold_minutes: 5,  description: 'Order demand — one print-job escalation per unit, claimed as a set.' },
  { role: 'printer-fleet',  title: 'Printer Fleet',  parent_role: 'print-jobs',  sla_minutes: 5,  target_per_hour: 30, priority_threshold_minutes: 5,  description: 'Twin availability adverts and in-flight print rows — the machines at work.', upstream_roles: ['print-servicer'] },
  { role: 'print-servicer', title: 'Print Servicer', parent_role: null,          sla_minutes: 10, target_per_hour: 10, priority_threshold_minutes: 10, description: 'Register unboxed machines and restore ones that fell offline.' },
] as const;

async function ensureTwinRoles(): Promise<void> {
  const details = await api('GET', '/api/roles/details').catch(() => ({ roles: [] }));
  const configured = new Map<string, any>((details?.roles ?? []).map((r: any) => [r.role, r]));
  // Create bare rows first — upstream_roles references must resolve.
  for (const cfg of TWIN_ROLE_CONFIG) {
    if (!configured.has(cfg.role)) await api('POST', '/api/roles', { role: cfg.role }).catch(() => { /* exists */ });
  }
  let applied = 0;
  for (const cfg of TWIN_ROLE_CONFIG) {
    const row = configured.get(cfg.role);
    if (row?.title) continue; // already configured — respect admin tuning
    const { role, ...body } = cfg;
    await api('PATCH', `/api/roles/${role}`, { ...body, ops_visible: true }).then(() => { applied++; }).catch((err: any) => {
      console.warn(`[${ts()}]   ⚠ role ${role}: ${String(err.message).slice(0, 80)}`);
    });
  }
  console.log(`[${ts()}] Pace Board roles ready (print-jobs → printer-fleet, print-servicer side)${applied ? ` — configured ${applied}` : ''}`);
}

// ── Fleet + order planning (always satisfiable) ───────────────────────────────

interface TwinSpec {
  printerId: string;
  wfId: string;
  filament: string;
  caps: CapabilitySet;
  model: string;
  serialNumber: string;
}

function parseCapSpec(spec: string): CapabilitySet {
  const s = spec.trim().toLowerCase();
  if (s === 'full' || s === '') return { xl: true, pdac: true, soft: true };
  if (s === 'base' || s === 'none') return { xl: false, pdac: false, soft: false };
  const set: CapabilitySet = { xl: false, pdac: false, soft: false };
  for (const k of s.split(',').map((x) => x.trim())) {
    if ((CAPABILITY_KEYS as readonly string[]).includes(k)) set[k as CapabilityKey] = true;
  }
  return set;
}

function planFleet(batchTag: string): TwinSpec[] {
  const capSpecs = (process.env.FLEET_CAPS || '').split('|').map((s) => s.trim()).filter(Boolean);
  return Array.from({ length: FLEET }, (_, i) => {
    const filament = FILAMENTS[i % FILAMENTS.length];
    const caps = capSpecs.length ? parseCapSpec(capSpecs[i % capSpecs.length]) : { xl: true, pdac: true, soft: true };
    const printerId = `${batchTag}-p${i}`;
    return { printerId, wfId: printerId, filament, caps, model: MODELS[i % MODELS.length], serialNumber: `SN-${batchTag.slice(-6)}-${i}` };
  });
}

interface OrderSpec {
  index: number;
  wfId: string;
  orderId: string;
  filament: string;
  require: Partial<CapabilitySet>;
  units: number;
}

function planOrders(batchTag: string, fleet: TwinSpec[]): OrderSpec[] {
  return Array.from({ length: ORDERS }, (_, i) => {
    const filament = FILAMENTS[i % FILAMENTS.length];
    const pool = fleet.filter((t) => t.filament === filament);
    const units = Math.max(1, Math.min(UNITS, pool.length));
    // Require a rotating capability only if enough printers of this filament have
    // it — otherwise the order would never place. Proves capability routing when
    // the fleet varies; a no-op (but still-threaded) facet when it's fully capable.
    const cap = CAPABILITY_KEYS[i % CAPABILITY_KEYS.length];
    const capable = pool.filter((t) => t.caps[cap]).length;
    const require: Partial<CapabilitySet> = (i % 2 === 0 && capable >= units) ? { [cap]: true } : {};
    return { index: i, wfId: `${batchTag}-o${i}`, orderId: `TWIN-${batchTag.slice(-6)}-${i}`, filament, require, units };
  });
}

// ── Launch twins + broker + orders ────────────────────────────────────────────

async function startTwin(spec: TwinSpec): Promise<void> {
  await api('POST', '/api/workflows/printerTwin/invoke', {
    workflowId: spec.wfId,
    data: { printerId: spec.printerId, operatorId: userId },
    metadata: { source: 'twin-farm' },
  });
}

async function startBroker(batchTag: string): Promise<string> {
  const wfId = `${batchTag}-broker`;
  await api('POST', '/api/workflows/twinBroker/invoke', {
    workflowId: wfId,
    data: { brokerId: userId, tickSeconds: 1, idleTickSeconds: 3, maxIdleRuns: BROKER_IDLE },
    metadata: { source: 'twin-farm' },
  });
  return wfId;
}

async function placeOrder(spec: OrderSpec): Promise<void> {
  await api('POST', '/api/workflows/twinOrder/invoke', {
    workflowId: spec.wfId,
    data: {
      orderId: spec.orderId,
      filament: spec.filament,
      require: spec.require,
      units: Array.from({ length: spec.units }, (_, u) => ({ gcodeUrl: `https://example.com/${spec.orderId}-u${u}.gcode` })),
      operatorId: userId,
    },
    metadata: { source: 'twin-farm' },
  });
}

// ── Human automation: the print-servicer ──────────────────────────────────────

/** Resolve registration escalations — the servicer bringing a machine online. */
async function registerLoop(fleet: Map<string, TwinSpec>): Promise<void> {
  while (!done) {
    try {
      const resp = await api('GET', '/api/escalations/available?role=print-servicer&subtype=registering&limit=100');
      for (const esc of resp?.escalations ?? []) {
        const spec = fleet.get(String(esc.metadata?.printerId ?? ''));
        if (!spec) continue;
        await api('POST', `/api/escalations/${esc.id}/resolve`, {
          resolverPayload: {
            serialNumber: spec.serialNumber,
            model: spec.model,
            manufactureDate: '2026-01-15',
            filament: spec.filament,
            certifications: 'CE, RoHS',
            xl: spec.caps.xl, pdac: spec.caps.pdac, soft: spec.caps.soft,
            notes: 'Auto-registered by twin-farm',
          },
        }).then(() => {
          stats.registered++;
          const c = CAPABILITY_KEYS.filter((k) => spec.caps[k]).join('+') || 'base';
          console.log(`[${ts()}]   [register] ${spec.printerId} — ${spec.model} ${spec.filament} (${c}) [${stats.registered}/${FLEET}]`);
        }).catch(() => { /* raced another poll */ });
      }
    } catch (err: any) { logPollErr('register', err); }
    if (!done) await sleep(POLL_MS);
  }
}

/** Resolve service escalations — the servicer realigning a downed machine. */
async function serviceLoop(): Promise<void> {
  while (!done) {
    try {
      const resp = await api('GET', '/api/escalations/available?role=print-servicer&subtype=service&limit=100');
      for (const esc of resp?.escalations ?? []) {
        await api('POST', `/api/escalations/${esc.id}/resolve`, {
          resolverPayload: { action: 'restored', notes: 'Auto-serviced by twin-farm' },
        }).then(() => {
          stats.serviced++;
          console.log(`[${ts()}]   [service]  ${esc.metadata?.printerId ?? esc.id.slice(0, 8)} restored [${stats.serviced}]`);
        }).catch(() => { /* raced */ });
      }
    } catch (err: any) { logPollErr('service', err); }
    if (!done) await sleep(POLL_MS);
  }
}

/** Cancel a deterministic fraction of in-flight prints — the power-outage /
 *  dead-machine drill. Best-effort: it races the physical side's resolve. */
async function failLoop(): Promise<void> {
  if (FAIL_PCT <= 0) return;
  const acted = new Set<string>();
  while (!done) {
    try {
      const resp = await api('GET', '/api/escalations/available?role=printer-fleet&subtype=printing&limit=100');
      for (const esc of resp?.escalations ?? []) {
        const jobId = String(esc.metadata?.jobId ?? esc.id);
        if (acted.has(jobId)) continue;
        if (jitter(jobId, 'fail') * 100 >= FAIL_PCT) continue;
        acted.add(jobId);
        await api('POST', `/api/escalations/${esc.id}/cancel`).then(() => {
          stats.cancelled++;
          console.log(`[${ts()}]   [FAIL]     cancelled print ${jobId} — machine went dark [${stats.cancelled}]`);
        }).catch(() => { /* physical side won the race — already resolved */ });
      }
    } catch (err: any) { logPollErr('fail', err); }
    if (!done) await sleep(Math.min(POLL_MS, 300));
  }
}

let lastPollErr = '';
function logPollErr(loop: string, err: any): void {
  const msg = `[${loop}] ${String(err?.message).slice(0, 80)}`;
  if (msg !== lastPollErr) { console.warn(`[${ts()}]   ⚠ ${msg}`); lastPollErr = msg; }
}

// ── Order arrival + settlement watch ──────────────────────────────────────────

async function orderLoop(orders: OrderSpec[]): Promise<void> {
  for (const order of orders) {
    if (done) break;
    try {
      await placeOrder(order);
      const req = Object.keys(order.require).length ? ` require:${Object.keys(order.require).join('+')}` : '';
      console.log(`[${ts()}]   [order]    ${order.index + 1}/${orders.length} ${order.orderId} — ${order.filament} ×${order.units}${req}`);
    } catch (err: any) {
      console.error(`[${ts()}]   [order]    ${order.orderId} FAILED: ${String(err.message).slice(0, 100)}`);
    }
    await sleep(spread(ARRIVAL_S, jitter(order.wfId, 'arrive')) * 1000);
  }
}

/** Poll each order's result; a settled order returns its outcomes. */
async function settlementWatch(orders: OrderSpec[]): Promise<void> {
  const settled = new Set<string>();
  let stalled = 0;
  const STALL_S = Math.max(40, ORDERS * (ARRIVAL_S + 8));
  while (!done) {
    await sleep(1000);
    let progressed = false;
    for (const order of orders) {
      if (settled.has(order.wfId)) continue;
      try {
        const resp = await api('GET', `/api/workflows/${order.wfId}/result`);
        const data = resp?.result?.data;
        if (data && data.completedAt !== undefined) {
          settled.add(order.wfId);
          progressed = true;
          stats.settled++;
          const outcomes: any[] = data.outcomes ?? [];
          const ok = outcomes.filter((o) => o.outcome === 'success').length;
          const bad = outcomes.length - ok;
          stats.printed += ok; stats.dispatched += outcomes.length;
          console.log(`[${ts()}]   [settle]   ${order.orderId} — ${ok} printed${bad ? `, ${bad} cancelled` : ''} [${stats.settled}/${ORDERS}]`);
        }
      } catch { /* 202 still running */ }
    }
    if (stats.settled >= ORDERS) { done = true; break; }
    stalled = progressed ? 0 : stalled + 1;
    if (stalled && stalled % 10 === 0) console.log(`[${ts()}]   … ${stats.settled}/${ORDERS} settled — waiting (${stalled}s quiet)`);
    if (stalled >= STALL_S) { console.warn(`[${ts()}]   ⚠ stalled ${stalled}s at ${stats.settled}/${ORDERS} — stopping`); done = true; break; }
  }
}

// ── Teardown: retire idle twins so nothing lingers ────────────────────────────

async function retireTwins(fleet: TwinSpec[]): Promise<void> {
  if (KEEP) { console.log(`[${ts()}] KEEP=1 — leaving ${fleet.length} twins advertising`); return; }
  await sleep(2000); // let any last twin re-advertise after a service visit
  let retired = 0;
  for (let sweep = 0; sweep < 4 && retired < fleet.length; sweep++) {
    try {
      const resp = await api('GET', '/api/escalations/available?role=printer-fleet&subtype=ready&limit=200');
      for (const esc of resp?.escalations ?? []) {
        try {
          await api('POST', `/api/escalations/${esc.id}/resolve`, { resolverPayload: { powerdown: true } });
          retired++;
        } catch { /* claimed or already gone */ }
      }
    } catch { /* ignore */ }
    if (retired < fleet.length) await sleep(1500);
  }
  console.log(`[${ts()}] Retired ${retired} idle twin${retired === 1 ? '' : 's'}`);
}

// ── Optional office-link preflight ────────────────────────────────────────────

async function preflightFarmManager(): Promise<void> {
  if (!FARM_MANAGER_URL) return;
  process.stdout.write(`[${ts()}] Preflight → ${FARM_MANAGER_URL} … `);
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 4000);
    const res = await fetch(FARM_MANAGER_URL, { signal: ctrl.signal }).finally(() => clearTimeout(t));
    console.log(`reachable (HTTP ${res.status}). Set FARM_MANAGER_BACKEND=http + FARM_MANAGER_BASE_URL on the app to dispatch for real.`);
  } catch (err: any) {
    console.log(`UNREACHABLE (${String(err?.message).slice(0, 60)}). Check the office wifi link — see the README connectivity walkthrough.`);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const runId = Math.floor(Date.now() / 1000).toString();
  const batchTag = `twin-${runId}`;
  const fleet = planFleet(batchTag);
  const fleetById = new Map(fleet.map((t) => [t.printerId, t]));

  console.log(`\n  Twin Farm  ──  ${FLEET} printers, ${ORDERS} orders (≤${UNITS} units), filaments [${FILAMENTS.join(', ')}]`);
  console.log(`  arrival=${ARRIVAL_S}s poll=${POLL_MS}ms fail=${FAIL_PCT}% broker=${RUN_BROKER ? `on (idle≤${BROKER_IDLE})` : 'external'} keep=${KEEP}`);
  console.log(`  Server: ${BASE_URL}\n`);

  await login();
  await ensureTwinRoles();
  await preflightFarmManager();

  // 1. Launch the fleet — each twin raises a registration escalation and parks.
  console.log(`\n[${ts()}] Launching ${FLEET} twins …`);
  for (const spec of fleet) await startTwin(spec);

  // 2. Register + service loops start now so twins come online as they appear.
  const humanLoops = [registerLoop(fleetById), serviceLoop(), failLoop()];

  // 3. Broker (once the humans are watching).
  if (RUN_BROKER) { await startBroker(batchTag); console.log(`[${ts()}] Broker running`); }

  // 4. Wait for the fleet to register before placing demand (so orders place).
  const registerDeadline = Date.now() + 30_000;
  while (stats.registered < FLEET && Date.now() < registerDeadline && !done) await sleep(500);
  if (stats.registered < FLEET) console.warn(`[${ts()}] ⚠ only ${stats.registered}/${FLEET} registered — placing orders anyway`);

  // 5. Orders arrive; settlement watch drives the run to completion.
  const orders = planOrders(batchTag, fleet);
  console.log(`\n[${ts()}] Placing ${ORDERS} orders …\n`);
  const startMs = Date.now();
  await Promise.all([orderLoop(orders), settlementWatch(orders), ...humanLoops.map((p) => p.catch(() => {}))]);
  const elapsed = ((Date.now() - startMs) / 1000).toFixed(1);

  await retireTwins(fleet);

  console.log(`\n[${ts()}] Done in ${elapsed}s`);
  console.log(`  Registered:  ${stats.registered}/${FLEET}`);
  console.log(`  Orders:      ${stats.settled}/${ORDERS} settled`);
  console.log(`  Units:       ${stats.printed} printed${stats.cancelled ? `, ${stats.cancelled} cancelled` : ''} (${stats.dispatched} dispatched)`);
  console.log(`  Serviced:    ${stats.serviced}`);
  console.log(`\n  Dashboard: ${BASE_URL}/escalations\n`);
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });

export {};
