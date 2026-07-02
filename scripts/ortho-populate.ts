/**
 * ortho-populate — Populate the Operations dashboard with ortho pipeline history.
 *
 * Adapted from the boilerplate's 08-day-resolver.ts pattern:
 *   - concurrent claim loop + resolve loop + watchdog via Promise.all
 *   - hold time read from esc.claimed_at (API), not tracked in memory
 *   - simple resolve payload { approved: true, station: role }
 *
 * Usage:
 *   npx ts-node scripts/ortho-populate.ts
 *   ORDERS=50 HOLD_S=3 npx ts-node scripts/ortho-populate.ts
 *   ORDERS=5  HOLD_S=0 POLL_MS=500 npx ts-node scripts/ortho-populate.ts
 *
 * Env vars:
 *   ORDERS    — number of orders to run (default 20)
 *   HOLD_S    — seconds to hold each escalation before resolving (default 2)
 *   POLL_MS   — poll interval ms (default 1000)
 *   BASE_URL  — server URL (default http://localhost:3000)
 */

try { require('dotenv/config'); } catch {}

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const ORDERS   = parseInt(process.env.ORDERS  || '20',   10);
const HOLD_S   = parseFloat(process.env.HOLD_S || '2');
const POLL_MS  = parseInt(process.env.POLL_MS  || '1000', 10);

const ORTHO_ROLES = ['design', 'review', 'print', 'grind', 'glue', 'finish', 'qa', 'ship'];

let token  = '';
let userId = '';
let totalClaimed  = 0;
let totalResolved = 0;

function ts(): string { return new Date().toISOString().slice(11, 19); }
function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }
function ageSeconds(iso: string): number { return (Date.now() - new Date(iso).getTime()) / 1000; }

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

// ── Claim: grab available ortho-stage escalations for this run ────────────────

async function claimBatch(batchTag: string): Promise<number> {
  try {
    const resp = await api('GET', '/api/escalations/available?type=ortho-stage&limit=100&sort_by=created_at&order=asc');
    const escalations: any[] = resp?.escalations ?? [];
    let claimed = 0;

    for (const esc of escalations) {
      if (!ORTHO_ROLES.includes(esc.role)) continue;
      if (!String(esc.workflow_id ?? '').includes(batchTag)) continue;

      try {
        await api('POST', `/api/escalations/${esc.id}/claim`, { durationMinutes: 600 });
        totalClaimed++;
        claimed++;
        console.log(`[${ts()}]   [claim]   ${esc.role.padEnd(8)} ${esc.id.slice(0, 8)}… [${totalClaimed} total]`);
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

async function resolveBatch(batchTag: string): Promise<number> {
  try {
    const resp = await api('GET', `/api/escalations?type=ortho-stage&status=pending&assigned_to=${userId}&limit=100&sort_by=created_at&order=asc`);
    const escalations: any[] = resp?.escalations ?? [];
    let resolved = 0;

    for (const esc of escalations) {
      if (!ORTHO_ROLES.includes(esc.role)) continue;
      if (!String(esc.workflow_id ?? '').includes(batchTag)) continue;

      const heldS = esc.claimed_at ? ageSeconds(esc.claimed_at) : 0;
      if (heldS < HOLD_S) continue;

      try {
        await api('POST', `/api/escalations/${esc.id}/resolve`, {
          resolverPayload: { approved: true, station: esc.role, completed_at: new Date().toISOString() },
        });
        totalResolved++;
        resolved++;
        console.log(`[${ts()}]   [resolve] ${esc.role.padEnd(8)} ${esc.id.slice(0, 8)}… held ${heldS.toFixed(1)}s [${totalResolved} total]`);
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

// ── Run all orders through all 8 stages ───────────────────────────────────────

async function runOrders(batchTag: string, target: number): Promise<void> {
  let done = false;

  // Claim loop — runs continuously until done.
  const claimLoop = async () => {
    while (!done) {
      await claimBatch(batchTag);
      if (!done) await sleep(POLL_MS);
    }
  };

  // Resolve loop — drains all held escalations each poll.
  const resolveLoop = async () => {
    while (!done) {
      await resolveBatch(batchTag);
      if (!done) await sleep(POLL_MS);
    }
  };

  // Watchdog — stops when target hit or stalled too long.
  const STALL_S = Math.max(30, HOLD_S * 6);
  const watchdog = async () => {
    let lastResolved = totalResolved;
    let stalledFor = 0;
    while (!done) {
      await sleep(1000);
      if (totalResolved >= target) { done = true; break; }
      if (totalResolved > lastResolved) {
        stalledFor = 0;
        lastResolved = totalResolved;
      } else {
        stalledFor++;
        if (stalledFor % 10 === 0) {
          console.log(`[${ts()}]   … ${totalResolved}/${target} resolved — waiting (${stalledFor}s quiet)`);
        }
        if (stalledFor >= STALL_S) {
          console.warn(`[${ts()}]   ⚠ stalled ${stalledFor}s with ${totalResolved}/${target} — stopping`);
          done = true; break;
        }
      }
    }
  };

  await Promise.all([claimLoop(), resolveLoop(), watchdog()]);
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n  Ortho Populate  ──  ${ORDERS} orders × 8 stages  (hold=${HOLD_S}s, poll=${POLL_MS}ms)`);
  console.log(`  Server: ${BASE_URL}\n`);

  await login();

  const runId = Math.floor(Date.now() / 1000).toString();
  const batchTag = `ortho-pop-${runId}`;
  const workflowIds: string[] = [];

  // Enqueue all orders.
  console.log(`[${ts()}] Enqueuing ${ORDERS} orders…`);
  for (let i = 0; i < ORDERS; i++) {
    const wfId = `${batchTag}-${i}`;
    try {
      await api('POST', '/api/workflows/orthoPipeline/invoke', {
        workflowId: wfId,
        data:     { order_id: `ORD-${runId}-${i}`, item_type: 'insole-standard' },
        metadata: { source: 'populate', run_id: runId },
      });
      workflowIds.push(wfId);
      console.log(`[${ts()}]   ${i + 1}/${ORDERS} → ${wfId}`);
    } catch (err: any) {
      console.error(`[${ts()}]   ${i + 1}/${ORDERS} FAILED: ${err.message}`);
    }
  }

  if (workflowIds.length === 0) { console.error('Nothing enqueued — aborting'); process.exit(1); }

  const target = workflowIds.length * 8;
  console.log(`\n[${ts()}] Running — target: ${target} resolutions (${workflowIds.length} orders × 8 stages)\n`);
  const startMs = Date.now();

  await runOrders(batchTag, target);

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
  console.log(`  Orders completed:  ${completed}`);
  console.log(`  Claimed:           ${totalClaimed}`);
  console.log(`  Resolved:          ${totalResolved}`);
  console.log(`\n  Dashboard: ${BASE_URL}/operations\n`);
}

main().catch((err) => { console.error(err); process.exit(1); });
