/**
 * Test 06 — Assembly Line Sustained Load (Durable stepIterator)
 *
 * Three concurrent loops:
 *   1. Enqueue — submit stepIterator workflows on an interval
 *   2. Claim — poll pending escalations for our workflowIds, claim them
 *   3. Resolve — submit claimed escalations for resolution
 *
 * Each workflow has 2 stations (grinder → gluer). Each station creates
 * an escalation, pauses, and resumes when signaled via the resolve API.
 *
 * Usage:
 *   npx ts-node tests/throughput/06-assembly-line.ts [target] [batchSize] [enqueueIntervalMs]
 *
 * Defaults: target=10, batchSize=5, enqueueInterval=3000
 */

const BASE_URL = `http://localhost:${process.env.PORT || 3000}`;
const TARGET = parseInt(process.argv[2] || '10', 10);
const BATCH_SIZE = parseInt(process.argv[3] || '5', 10);
const ENQUEUE_INTERVAL_MS = parseInt(process.argv[4] || '3000', 10);

const TASK_QUEUE = 'long-tail-examples';
const STATIONS = [
  { stationName: 'grinder', role: 'grinder', instructions: 'Grind widget to spec.' },
  { stationName: 'gluer', role: 'gluer', instructions: 'Bond components. Verify bond strength.' },
];

let token = '';

async function api(method: string, path: string, body?: any): Promise<any> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${JSON.stringify(data)}`);
  return data;
}

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

async function main() {
  // 1. Login
  console.log('1. Login');
  const auth = await api('POST', '/api/auth/login', { username: 'superadmin', password: 'l0ngt@1l' });
  token = auth.token;
  if (!token) { console.error('Login failed'); process.exit(1); }

  // 2. Register workflow config
  console.log('2. Register stepIterator config');
  await api('PUT', '/api/workflows/stepIterator/config', {
    invocable: true,
    task_queue: TASK_QUEUE,
    default_role: 'reviewer',
  });

  console.log(`\nAssembly line sustained: ${TARGET} orders, ${BATCH_SIZE}/batch every ${ENQUEUE_INTERVAL_MS / 1000}s\n`);

  // State
  const workflowIds = new Set<string>();
  let submitted = 0;

  // Escalation tracking: pending → claimed → resolved
  const claimed = new Map<string, { role: string }>(); // escalationId → metadata
  const resolvedIds = new Set<string>();
  let claimCount = 0;
  let resolveCount = 0;
  let completed = 0;
  let peakInFlight = 0;
  const t0 = performance.now();

  const expectedEscalations = TARGET * STATIONS.length;

  // ── Loop 1: Enqueue workflows ─────────────────────────────────────
  const enqueueLoop = (async () => {
    while (submitted < TARGET) {
      const batch = Math.min(BATCH_SIZE, TARGET - submitted);
      const promises = Array.from({ length: batch }, (_, i) => {
        return api('POST', '/api/workflows/stepIterator/invoke', {
          data: {
            name: `Widget-${submitted + i}`,
            steps: STATIONS,
          },
        });
      });
      const results = await Promise.all(promises);
      for (const r of results) {
        if (r?.workflowId) workflowIds.add(r.workflowId);
      }
      submitted += batch;
      const elapsed = ((performance.now() - t0) / 1000).toFixed(1);
      console.log(`[${elapsed}s] Enqueued: ${submitted}/${TARGET}`);
      if (submitted < TARGET) await sleep(ENQUEUE_INTERVAL_MS);
    }
    console.log(`[${((performance.now() - t0) / 1000).toFixed(1)}s] All ${TARGET} submitted`);
  })();

  // ── Loop 2: Claim escalations ─────────────────────────────────────
  const claimLoop = (async () => {
    await sleep(2000);
    while (claimCount < expectedEscalations) {
      try {
        // Poll each station role separately to avoid missing any
        for (const station of STATIONS) {
          const resp = await api('GET', `/api/escalations?status=pending&role=${station.role}&limit=50`);
          const pending = resp?.escalations || [];

          for (const esc of pending) {
            // Only claim escalations belonging to our workflows
            if (!esc.workflow_id) continue;
            // workstation child IDs contain the parent workflowId
            const isOurs = [...workflowIds].some((wfId) => esc.workflow_id.includes(wfId));
            if (!isOurs) continue;
            if (claimed.has(esc.id) || resolvedIds.has(esc.id)) continue;

            try {
              await api('POST', `/api/escalations/${esc.id}/claim`);
              claimed.set(esc.id, { role: esc.role });
              claimCount++;
            } catch { /* already claimed or gone */ }
          }
        }
      } catch { /* transient */ }
      await sleep(1000);
    }
  })();

  // ── Loop 3: Resolve claimed escalations ───────────────────────────
  const resolveLoop = (async () => {
    await sleep(3000);
    while (resolveCount < expectedEscalations) {
      for (const [escId, meta] of claimed.entries()) {
        if (resolvedIds.has(escId)) continue;
        try {
          await api('POST', `/api/escalations/${escId}/resolve`, {
            resolverPayload: { approved: true, station: meta.role },
          });
          resolvedIds.add(escId);
          claimed.delete(escId);
          resolveCount++;
        } catch { /* transient */ }
      }
      await sleep(1000);
    }
  })();

  // ── Loop 4: Monitor ───────────────────────────────────────────────
  const monitorLoop = (async () => {
    while (true) {
      await sleep(5000);
      // Count completed by checking workflow results
      let completedCount = 0;
      for (const wfId of workflowIds) {
        try {
          const result = await api('GET', `/api/workflows/${wfId}/result`);
          if (result?.result?.type === 'return') completedCount++;
        } catch { /* not done yet */ }
      }
      completed = completedCount;
      const inFlight = submitted - completed;
      if (inFlight > peakInFlight) peakInFlight = inFlight;
      const elapsed = ((performance.now() - t0) / 1000).toFixed(1);
      console.log(`[${elapsed}s] Submitted=${submitted} Claimed=${claimCount} Resolved=${resolveCount} Completed=${completed}/${TARGET}  peak=${peakInFlight}`);

      if (completed >= TARGET) break;
      if (performance.now() - t0 > 600_000) {
        console.log('TIMEOUT after 10 minutes');
        break;
      }
    }
  })();

  await Promise.all([enqueueLoop, claimLoop, resolveLoop, monitorLoop]);

  const totalElapsed = (performance.now() - t0) / 1000;
  console.log(`\n${'='.repeat(60)}`);
  console.log('Assembly Line Sustained — Results');
  console.log(`${'='.repeat(60)}`);
  console.log(`  Target:          ${TARGET} orders`);
  console.log(`  Stations:        ${STATIONS.length} per order`);
  console.log(`  Batch size:      ${BATCH_SIZE} every ${ENQUEUE_INTERVAL_MS / 1000}s`);
  console.log(`  Total time:      ${totalElapsed.toFixed(1)}s`);
  console.log(`  Submitted:       ${submitted}`);
  console.log(`  Claimed:         ${claimCount}`);
  console.log(`  Resolved:        ${resolveCount}`);
  console.log(`  Completed:       ${completed}`);
  console.log(`  Peak in-flight:  ${peakInFlight}`);
  console.log(`  Throughput:      ${(completed / totalElapsed).toFixed(1)} orders/sec e2e`);
  console.log(`  Avg per order:   ${(totalElapsed / completed * 1000).toFixed(0)}ms`);

  process.exit(completed >= TARGET ? 0 : 1);
}

main().catch((err) => { console.error(err); process.exit(1); });
