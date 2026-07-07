/**
 * ortho-populate — Populate the Operations dashboard with ortho pipeline history.
 *
 * Adapted from the boilerplate's 08-day-resolver.ts pattern:
 *   - concurrent enqueue + claim loop + resolve loop + watchdog via Promise.all
 *   - hold time read from esc.claimed_at (API), not tracked in memory
 *   - simple resolve payload { approved: true, station: role }
 *
 * Usage:
 *   npx ts-node scripts/ortho-populate.ts
 *   ORDERS=50 HOLD_S=3 npx ts-node scripts/ortho-populate.ts
 *   ORDERS=10 HOLD_S=25 npx ts-node scripts/ortho-populate.ts
 *   ORDERS=5  HOLD_S=0 QUEUE_S=0 SHOES_PCT=0 POLL_MS=500 npx ts-node scripts/ortho-populate.ts
 *
 * Env vars:
 *   ORDERS     — number of orders to run (default 20)
 *   HOLD_S     — average seconds to hold each claimed escalation before
 *                resolving (default 2)
 *   QUEUE_S    — average seconds an escalation waits in the queue before being
 *                claimed (default: HOLD_S). This is what builds a visible
 *                backlog: on the Operations chart, queued-but-unclaimed and
 *                claimed-and-worked are two different bands — with QUEUE_S=0
 *                everything is claimed the moment it lands and pending always
 *                equals active.
 *   SHOES_PCT  — percent of orders that include shoes (default 50). A shoe
 *                order runs the side-quest sequence (ordering → inserting)
 *                alongside its manufacturing line — see below.
 *   ARRIVAL_S  — average seconds between order arrivals (default: HOLD_S).
 *                Orders trickle in at this rate instead of landing as one
 *                wave, so the chart shows throughput, not a step function.
 *   POLL_MS    — poll interval ms (default 1000)
 *   BASE_URL   — server URL (default http://localhost:3000)
 *
 * All durations are per-item averages, not fixed delays: each escalation gets
 * its own wait and hold spread across 0.4×–1.6× of the configured value (a
 * stable hash of its id — no state to track between polls). That staggering is
 * what makes the Operations chart read like a real floor: at any moment a
 * station holds a mix of waiting and active items, claims burn the backlog
 * down gradually, and resolves feed the next station a trickle instead of a
 * wave.
 *
 * Every escalation this run creates carries `metadata.authorized_at` — an ISO
 * 8601 UTC timestamp stamped when the order arrives, identical across all of
 * that order's stages (main line and shoe side-quest). Point a role's
 * `priority_facet` at `authorized_at` with a threshold (e.g. 1 minute) and the
 * Pace Board priority count lights up as orders age through the run.
 *
 * ── The shoe side-quest ──────────────────────────────────────────────────────
 * A shoe order exercises the cross-sequence model (ordering → inserting feeds
 * ship via upstream_roles — its own Operations sequence, not a bend in the
 * main line). Timing tells the physical story, scaled to the manufacturing
 * duration (MFG ≈ 8 stages × (QUEUE_S + HOLD_S)):
 *
 *   arrival     ordering escalation created with the order
 *   + ~½·QUEUE  claimed quickly — the shoes are on order, work is underway
 *   + ~35% MFG  shoes arrive → ordering resolves → inserting created
 *   + ~35% MFG  inserting sits AVAILABLE (you cannot stuff inserts until the
 *               insole is made) — a long sky band on its station
 *   + HOLD      claimed and resolved just ahead of shipping
 *
 * The script provisions the side-quest roles idempotently on start (ordering,
 * inserting under it, ship fed by inserting).
 */

try { require('dotenv/config'); } catch {}

const BASE_URL  = process.env.BASE_URL || 'http://localhost:3000';
const ORDERS    = parseInt(process.env.ORDERS  || '20',   10);
const HOLD_S    = parseFloat(process.env.HOLD_S || '2');
const QUEUE_S   = parseFloat(process.env.QUEUE_S ?? String(HOLD_S));
const SHOES_PCT = parseInt(process.env.SHOES_PCT || '50', 10);
const ARRIVAL_S = parseFloat(process.env.ARRIVAL_S ?? String(HOLD_S));
const POLL_MS   = parseInt(process.env.POLL_MS  || '1000', 10);

const ORTHO_ROLES = ['design', 'review', 'print', 'grind', 'glue', 'finish', 'qa', 'ship'];
const SIDE_ROLES  = ['ordering', 'inserting'];
const ALL_ROLES   = [...ORTHO_ROLES, ...SIDE_ROLES];

// Average end-to-end manufacturing time — the side-quest paces derive from it.
const MFG_S            = ORTHO_ROLES.length * (QUEUE_S + HOLD_S);
const TRANSIT_S        = 0.35 * MFG_S; // shoes underway with the vendor (held)
const INSERT_QUEUE_S   = 0.35 * MFG_S; // inserting waits available for inserts
const ORDERING_QUEUE_S = 0.5 * QUEUE_S; // shoes get ordered promptly

let token  = '';
let userId = '';
let totalClaimed  = 0;
let totalResolved = 0;

function ts(): string { return new Date().toISOString().slice(11, 19); }
function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }
function ageSeconds(iso: string): number { return (Date.now() - new Date(iso).getTime()) / 1000; }

// Deterministic per-item jitter — FNV-1a hash of the escalation id into [0, 1).
// Stable across polls, so each item has one fixed wait and one fixed hold
// without any bookkeeping.
function jitter(id: string, salt: string): number {
  let h = 2166136261;
  for (const c of salt + id) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 1000) / 1000;
}

/** Spread a base duration across 0.4×–1.6× so a stage's items trickle instead of toggling together. */
function spread(base: number, r: number): number { return base * (0.4 + 1.2 * r); }

/** Evenly distribute SHOES_PCT across the order sequence (deterministic). */
function hasShoes(i: number): boolean {
  return Math.floor(((i + 1) * SHOES_PCT) / 100) > Math.floor((i * SHOES_PCT) / 100);
}

/** Queue wait before this escalation may be claimed. */
function claimWaitFor(esc: { id: string; role: string }): number {
  const base = esc.role === 'ordering' ? ORDERING_QUEUE_S
    : esc.role === 'inserting' ? INSERT_QUEUE_S
    : QUEUE_S;
  return spread(base, jitter(esc.id, 'queue'));
}

/** Hold time after claim before this escalation may be resolved. */
function holdFor(esc: { id: string; role: string }): number {
  const base = esc.role === 'ordering' ? TRANSIT_S : HOLD_S;
  return spread(base, jitter(esc.id, 'hold'));
}

// ── HTTP helper (mirrors boilerplate 07-shared) ───────────────────────────────

async function api(method: string, path: string, body?: unknown): Promise<any> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${JSON.stringify(data)}`);
  return data;
}

// ── Auth ─────────────────────────────────────────────────────────────────────

async function login() {
  const auth = await api('POST', '/api/auth/login', { username: 'superadmin', password: 'l0ngt@1l' });
  token  = auth.token;
  userId = auth.user?.id || '';
  if (!token) { console.error('[auth] Login failed'); process.exit(1); }
  console.log(`[${ts()}] Logged in (userId: ${userId.slice(0, 8)}…)`);
}

// ── Side-quest role provisioning (idempotent) ─────────────────────────────────

async function ensureSideQuestRoles(): Promise<void> {
  for (const role of SIDE_ROLES) {
    await api('POST', '/api/roles', { role }).catch(() => { /* exists */ });
  }
  await api('PATCH', '/api/roles/ordering', {
    title: 'Ordering', ops_visible: true, target_per_hour: 22,
  });
  await api('PATCH', '/api/roles/inserting', {
    title: 'Inserting', ops_visible: true, parent_role: 'ordering', target_per_hour: 22,
  });
  // ship draws from inserting across sequences — union, never clobber.
  const details = await api('GET', '/api/roles/details');
  const ship = (details?.roles ?? []).find((r: any) => r.role === 'ship');
  const upstreams: string[] = ship?.upstream_roles ?? [];
  if (!upstreams.includes('inserting')) {
    await api('PATCH', '/api/roles/ship', { upstream_roles: [...upstreams, 'inserting'] });
  }
  console.log(`[${ts()}] Side-quest roles ready (ordering → inserting ⇒ ship)`);
}

// ── Side-quest escalations (standalone rows — no workflow behind them) ────────

async function createSideEscalation(
  role: string,
  workflowId: string,
  orderId: string,
  runId: string,
  description: string,
  authorizedAt: string,
): Promise<boolean> {
  try {
    await api('POST', '/api/escalations', {
      type: 'ortho-stage',
      subtype: role,
      role,
      description,
      workflow_id: workflowId,
      envelope: JSON.stringify({ order_id: orderId }),
      metadata: { order_id: orderId, source: 'populate', run_id: runId, authorized_at: authorizedAt },
    });
    return true;
  } catch (err: any) {
    console.error(`[${ts()}]   [${role}] create error: ${String(err.message).slice(0, 80)}`);
    return false;
  }
}

// ── Claim: grab available escalations for this run once their wait elapses ────

async function claimBatch(batchTag: string): Promise<number> {
  try {
    const resp = await api('GET', '/api/escalations/available?type=ortho-stage&limit=100&sort_by=created_at&order=asc');
    const escalations: any[] = resp?.escalations ?? [];
    let claimed = 0;

    for (const esc of escalations) {
      if (!ALL_ROLES.includes(esc.role)) continue;
      if (!String(esc.workflow_id ?? '').includes(batchTag)) continue;
      // Let the item sit in the queue first — this is the unclaimed backlog the
      // Operations chart renders as the "waiting" band above the active band.
      // Each item gets its own wait so the backlog burns down gradually.
      if (esc.created_at && ageSeconds(esc.created_at) < claimWaitFor(esc)) continue;

      try {
        await api('POST', `/api/escalations/${esc.id}/claim`, { durationMinutes: 600 });
        totalClaimed++;
        claimed++;
        console.log(`[${ts()}]   [claim]   ${esc.role.padEnd(9)} ${esc.id.slice(0, 8)}… [${totalClaimed} total]`);
      } catch (err: any) {
        const msg = String(err.message).slice(0, 80);
        if (!msg.includes('409') && !msg.includes('conflict') && !msg.includes('already')) {
          console.warn(`[${ts()}]   [claim]   err: ${msg}`);
        }
      }
    }
    return claimed;
  } catch (err: any) {
    console.error(`[${ts()}]   [claim] poll error: ${err.message.slice(0, 80)}`);
    return 0;
  }
}

// ── Resolve: drain all claimed+held escalations for this run ─────────────────

async function resolveBatch(batchTag: string, runId: string): Promise<number> {
  try {
    const resp = await api('GET', `/api/escalations?type=ortho-stage&status=pending&assigned_to=${userId}&limit=100&sort_by=created_at&order=asc`);
    const escalations: any[] = resp?.escalations ?? [];
    let resolved = 0;

    for (const esc of escalations) {
      if (!ALL_ROLES.includes(esc.role)) continue;
      if (!String(esc.workflow_id ?? '').includes(batchTag)) continue;

      // Per-item hold: some resolvers are quick, some slow — resolves trickle
      // out and feed the next station a steady stream instead of a wave.
      // ordering holds for the vendor transit time instead of a work hold.
      const heldS = esc.claimed_at ? ageSeconds(esc.claimed_at) : 0;
      if (heldS < holdFor(esc)) continue;

      try {
        await api('POST', `/api/escalations/${esc.id}/resolve`, {
          resolverPayload: { approved: true, station: esc.role, completed_at: new Date().toISOString() },
        });
        totalResolved++;
        resolved++;
        console.log(`[${ts()}]   [resolve] ${esc.role.padEnd(9)} ${esc.id.slice(0, 8)}… held ${heldS.toFixed(1)}s [${totalResolved} total]`);

        // Shoes arrived — the side quest advances to inserting, which sits
        // available until the manufactured inserts catch up with it. The
        // order's authorized_at rides along from the ordering escalation.
        if (esc.role === 'ordering') {
          const orderId = esc.metadata?.order_id ?? '';
          await createSideEscalation(
            'inserting', esc.workflow_id, orderId, runId,
            `Stuff inserts into shoes for ${orderId}`,
            esc.metadata?.authorized_at ?? new Date().toISOString(),
          );
        }
      } catch (err: any) {
        console.error(`[${ts()}]   [resolve] ${esc.id.slice(0, 8)}… error: ${err.message.slice(0, 60)}`);
      }
    }
    return resolved;
  } catch (err: any) {
    console.error(`[${ts()}]   [resolve] poll error: ${err.message.slice(0, 80)}`);
    return 0;
  }
}

// ── Run: enqueue at arrival rate + claim + resolve + watchdog, concurrently ──

interface PlannedOrder { index: number; wfId: string; orderId: string; shoes: boolean; }

async function runOrders(
  batchTag: string,
  runId: string,
  plan: PlannedOrder[],
  target: { value: number },
): Promise<string[]> {
  let done = false;
  const workflowIds: string[] = [];

  // Enqueue loop — orders arrive at ARRIVAL_S pace (jittered), simulating
  // intake throughput instead of one opening wave. A shoe order launches its
  // ordering escalation the moment it lands.
  const enqueueLoop = async () => {
    for (const order of plan) {
      if (done) break;
      // The order's authorization moment — stamped once at arrival and carried
      // on every stage escalation via the workflow's metadata passthrough, so
      // an `authorized_at` priority facet measures journey age.
      const authorizedAt = new Date().toISOString();
      try {
        await api('POST', '/api/workflows/orthoPipeline/invoke', {
          workflowId: order.wfId,
          data: {
            order_id: order.orderId,
            item_type: 'insole-standard',
            metadata: { source: 'populate', run_id: runId, authorized_at: authorizedAt },
          },
          metadata: { source: 'populate', run_id: runId, shoes: order.shoes },
        });
        workflowIds.push(order.wfId);
        console.log(`[${ts()}]   [arrive]  ${order.index + 1}/${plan.length} → ${order.wfId}${order.shoes ? ' +shoes' : ''}`);
      } catch (err: any) {
        target.value -= 8 + (order.shoes ? 2 : 0);
        console.error(`[${ts()}]   [arrive]  ${order.index + 1}/${plan.length} FAILED: ${err.message}`);
        continue;
      }
      if (order.shoes) {
        const ok = await createSideEscalation(
          'ordering', `${order.wfId}-shoes`, order.orderId, runId,
          `Order shoes for ${order.orderId}`,
          authorizedAt,
        );
        if (!ok) target.value -= 2;
      }
      await sleep(spread(ARRIVAL_S, jitter(order.wfId, 'arrive')) * 1000);
    }
  };

  const claimLoop = async () => {
    while (!done) {
      await claimBatch(batchTag);
      if (!done) await sleep(POLL_MS);
    }
  };

  const resolveLoop = async () => {
    while (!done) {
      await resolveBatch(batchTag, runId);
      if (!done) await sleep(POLL_MS);
    }
  };

  // Watchdog — stops when target hit or stalled too long. Stages spend
  // QUEUE_S unclaimed + HOLD_S claimed (the side quest waits longer but
  // overlaps the main line, which keeps resolutions flowing), so the quiet
  // window scales with both.
  const STALL_S = Math.max(30, (HOLD_S + QUEUE_S) * 8);
  const watchdog = async () => {
    let lastResolved = totalResolved;
    let stalledFor = 0;
    while (!done) {
      await sleep(1000);
      if (totalResolved >= target.value) { done = true; break; }
      if (totalResolved > lastResolved) {
        stalledFor = 0;
        lastResolved = totalResolved;
      } else {
        stalledFor++;
        if (stalledFor % 10 === 0) {
          console.log(`[${ts()}]   … ${totalResolved}/${target.value} resolved — waiting (${stalledFor}s quiet)`);
        }
        if (stalledFor >= STALL_S) {
          console.warn(`[${ts()}]   ⚠ stalled ${stalledFor}s with ${totalResolved}/${target.value} — stopping`);
          done = true; break;
        }
      }
    }
  };

  await Promise.all([enqueueLoop(), claimLoop(), resolveLoop(), watchdog()]);
  return workflowIds;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const runId = Math.floor(Date.now() / 1000).toString();
  const batchTag = `ortho-pop-${runId}`;

  const plan: PlannedOrder[] = Array.from({ length: ORDERS }, (_, i) => ({
    index: i,
    wfId: `${batchTag}-${i}`,
    orderId: `ORD-${runId}-${i}`,
    shoes: hasShoes(i),
  }));
  const shoeCount = plan.filter((o) => o.shoes).length;
  // Each order resolves 8 manufacturing stages; a shoe order adds
  // ordering + inserting on the side-quest sequence.
  const target = { value: ORDERS * 8 + shoeCount * 2 };

  console.log(`\n  Ortho Populate  ──  ${ORDERS} orders × 8 stages, ${shoeCount} with shoes (+2 each)`);
  console.log(`  queue=${QUEUE_S}s hold=${HOLD_S}s arrival=${ARRIVAL_S}s shoes=${SHOES_PCT}% poll=${POLL_MS}ms`);
  console.log(`  Side quest: transit≈${TRANSIT_S.toFixed(0)}s, inserting waits≈${INSERT_QUEUE_S.toFixed(0)}s (MFG≈${MFG_S.toFixed(0)}s)`);
  console.log(`  Server: ${BASE_URL}\n`);

  await login();
  await ensureSideQuestRoles();

  console.log(`\n[${ts()}] Running — target: ${target.value} resolutions\n`);
  const startMs = Date.now();

  const workflowIds = await runOrders(batchTag, runId, plan, target);

  const elapsed = ((Date.now() - startMs) / 1000).toFixed(1);
  await sleep(2000);

  // Count completed workflows.
  let completed = 0;
  for (const wfId of workflowIds) {
    try {
      const resp = await api('GET', `/api/workflows/${wfId}/result`);
      if (resp?.result?.data?.results?.length === 8) completed++;
    } catch { /* still running */ }
  }

  console.log(`\n[${ts()}] Done in ${elapsed}s`);
  console.log(`  Orders submitted:  ${workflowIds.length}`);
  console.log(`  Orders with shoes: ${shoeCount}`);
  console.log(`  Orders completed:  ${completed}`);
  console.log(`  Claimed:           ${totalClaimed}`);
  console.log(`  Resolved:          ${totalResolved}`);
  console.log(`\n  Dashboard: ${BASE_URL}/operations\n`);
}

main().catch((err) => { console.error(err); process.exit(1); });
