/**
 * consolidation-sim: drive the consolidation example over HTTP so the
 * Consolidate list shows a floor in motion.
 *
 * Opens a tub per destination (the first tub split into a standard and an
 * express lane), starts orders with a mix of service levels, then walks
 * them through the stations (prep, check) and places each in its
 * destination's bin. With KEEP=1 it stops partway, leaving orders at every
 * station and some bins partly filled, so the list's Holds and Coming
 * columns and each row's expansion have something to show.
 *
 * Usage:
 *   npm run consolidation:sim
 *   DESTINATIONS=3 ORDERS=12 EXPRESS_PCT=30 KEEP=1 npm run consolidation:sim
 *
 * Env vars:
 *   BASE_URL       long-tail API (default http://localhost:3000)
 *   DESTINATIONS   destinations, one tub each (default 2)
 *   ORDERS         orders to start (default 8)
 *   EXPRESS_PCT    percent of orders on the express service (default 25)
 *   STEP_MS        pause between floor moves (default 600)
 *   KEEP           1 = stop partway and leave the floor mid-flight (default 0)
 *   LT_USERNAME / LT_PASSWORD   the dev login (defaults: the seeded admin)
 */

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const DESTINATIONS = Number(process.env.DESTINATIONS || 2);
const ORDERS = Number(process.env.ORDERS || 8);
const EXPRESS_PCT = Number(process.env.EXPRESS_PCT || 25);
const STEP_MS = Number(process.env.STEP_MS || 600);
const KEEP = process.env.KEEP === '1';
const USERNAME = process.env.LT_USERNAME || 'superadmin';
const PASSWORD = process.env.LT_PASSWORD || 'l0ngt@1l';

const ROLES = { PREP: 'order-prep', CHECK: 'order-check', STAGE: 'order-stage', BIN: 'consolidate' } as const;
const RUN = Date.now().toString(36).slice(-4).toUpperCase();
const DESTINATION_NAMES = ['north', 'south', 'east', 'west', 'central', 'harbor'];

let token = '';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function api<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${data.error ?? text}`);
  return data as T;
}

/** The pending row for one order at one role, polled until the workflow parks it. */
async function rowFor(role: string, facets: Record<string, unknown>): Promise<{ id: string }> {
  const q = new URLSearchParams({ role, status: 'pending', limit: '1', facets: JSON.stringify(facets) });
  for (let i = 0; i < 100; i++) {
    const { escalations } = await api<{ escalations: { id: string }[] }>('GET', `/api/escalations?${q}`);
    if (escalations[0]) return escalations[0];
    await sleep(200);
  }
  throw new Error(`no pending ${role} row for ${JSON.stringify(facets)}`);
}

interface Order { orderId: string; destination: string; serviceLevel: string }
interface Bin { id: string; destination: string; lane?: string }

async function openBins(destinations: string[]): Promise<Bin[]> {
  const bins: Bin[] = [];
  for (const [i, destination] of destinations.entries()) {
    const binKey = `T${i + 1}-${RUN}`;
    const lanes = i === 0 ? ['standard', 'express'] : [undefined];
    for (const lane of lanes) {
      await api('POST', '/api/workflows/consolidationBin/invoke', { data: { binKey, destination, lane, max: 20, timeout: '8h' } });
      const row = await rowFor(ROLES.BIN, { binKey, ...(lane ? { lane } : {}) });
      bins.push({ id: row.id, destination, lane });
      console.log(`[bin] ${binKey}${lane ? ` (${lane})` : ''} → ${destination}`);
    }
  }
  return bins;
}

async function startOrders(destinations: string[]): Promise<Order[]> {
  const orders: Order[] = [];
  for (let i = 0; i < ORDERS; i++) {
    const order = {
      orderId: `O${RUN}-${String(i + 1).padStart(2, '0')}`,
      destination: destinations[i % destinations.length],
      serviceLevel: Math.random() * 100 < EXPRESS_PCT ? 'express' : 'standard',
    };
    await api('POST', '/api/workflows/consolidationOrder/invoke', { data: order });
    orders.push(order);
    console.log(`[order] ${order.orderId} → ${order.destination} (${order.serviceLevel})`);
  }
  return orders;
}

async function finish(role: string, order: Order): Promise<void> {
  const row = await rowFor(role, { orderId: order.orderId });
  await api('POST', `/api/escalations/${row.id}/resolve`, { resolverPayload: { ok: true } });
  console.log(`[${role}] ${order.orderId} done`);
  await sleep(STEP_MS);
}

async function place(order: Order, bins: Bin[]): Promise<void> {
  const bin = bins.find((b) => b.destination === order.destination && (!b.lane || b.lane === order.serviceLevel))!;
  const member = await rowFor(ROLES.STAGE, { orderId: order.orderId });
  await api('POST', `/api/escalations/${bin.id}/accumulate`, {
    itemKey: order.orderId, payload: { weight: 1 }, reciprocal: { id: member.id },
  });
  console.log(`[place] ${order.orderId} → ${bin.destination}${bin.lane ? ` (${bin.lane})` : ''}`);
  await sleep(STEP_MS);
}

async function main(): Promise<void> {
  const auth = await api<{ token: string }>('POST', '/api/auth/login', { username: USERNAME, password: PASSWORD });
  token = auth.token;
  const destinations = DESTINATION_NAMES.slice(0, Math.max(1, Math.min(DESTINATIONS, DESTINATION_NAMES.length)))
    .map((d) => `${d}-${RUN}`);

  // 1. Open the tubs, then start the orders at the first station.
  const bins = await openBins(destinations);
  const orders = await startOrders(destinations);

  // 2. Walk the orders. Mid-flight (KEEP=1): a quarter stays at prep, a
  //    quarter at check, a quarter staged, the rest placed.
  const quarter = Math.ceil(orders.length / 4);
  for (const [i, order] of orders.entries()) {
    if (KEEP && i < quarter) continue;
    await finish(ROLES.PREP, order);
    if (KEEP && i < quarter * 2) continue;
    await finish(ROLES.CHECK, order);
    if (KEEP && i < quarter * 3) continue;
    await place(order, bins);
  }

  // 3. A mis-placed order comes back out: the bin's count drops by one.
  const placed = KEEP ? orders.slice(quarter * 3) : orders;
  const last = placed[placed.length - 1];
  if (last) {
    const bin = bins.find((b) => b.destination === last.destination && (!b.lane || b.lane === last.serviceLevel))!;
    await api('POST', `/api/escalations/${bin.id}/remove-item`, { itemKey: last.orderId });
    console.log(`[remove] ${last.orderId} out of ${bin.destination}`);
  }

  console.log(`\nDone (run ${RUN}). Open the Consolidate list: ${BASE_URL}/escalations/available?role=${ROLES.BIN}`);
}

main().catch((err) => {
  console.error(`[consolidation-sim] ${err.message}`);
  process.exit(1);
});

export {};
