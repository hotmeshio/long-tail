/**
 * Test 05 — Factory Sustained Load
 *
 * Three concurrent loops simulate realistic factory floor traffic:
 *   1. Enqueue loop — submit BATCH_SIZE orders every ENQUEUE_INTERVAL_MS
 *   2. Claim loop — poll for pending escalations matching our jobIds, claim them
 *   3. Resolve loop — submit claimed escalations for resolution (once each)
 *
 * Each escalation moves through: pending → claimed → submitted.
 * Local tracking prevents double-claiming or double-resolving.
 *
 * Usage:
 *   npx ts-node tests/throughput/05-factory-sustained.ts [target] [batchSize] [enqueueIntervalMs]
 *
 * Defaults: target=100, batchSize=10, enqueueInterval=5000
 */

import http from 'http';
import { readFileSync } from 'fs';
import { join } from 'path';

const API_PORT = process.env.PORT || '3000';
const TARGET = parseInt(process.argv[2] || '100', 10);
const BATCH_SIZE = parseInt(process.argv[3] || '10', 10);
const ENQUEUE_INTERVAL_MS = parseInt(process.argv[4] || '5000', 10);

const STATIONS = ['qc_inspector', 'packaging', 'shipping', 'loading_dock', 'final_signoff'];

function api(method: string, path: string, body?: any, token?: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const opts: http.RequestOptions = {
      hostname: 'localhost',
      port: API_PORT,
      path: `/api${path}`,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    };
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve({ raw: data, status: res.statusCode }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

function buildManifest(): any[] {
  const manifest: any[] = [
    { activity_id: 'trigger_ff', title: 'Trigger', type: 'trigger', tool_source: 'trigger', topic: 'factory_floor', input_mappings: {}, output_fields: ['orderId', 'product'] },
  ];
  for (const step of ['ingest', 'classify', 'prepress', 'print', 'scan']) {
    manifest.push({ activity_id: `${step}_ff`, title: step, type: 'worker', tool_source: 'mcp', topic: 'factory_floor', workflow_name: 'get_knowledge', mcp_server_id: 'long-tail-knowledge', mcp_tool_name: 'get_knowledge', input_mappings: {}, output_fields: [] });
  }
  const hookTopics = ['factory_qc_ack', 'factory_pack_ack', 'factory_ship_ack', 'factory_dock_ack', 'factory_signoff_ack'];
  const escIds = ['esc_qc_ff', 'esc_pack_ff', 'esc_ship_ff', 'esc_dock_ff', 'esc_signoff_ff'];
  const waitIds = ['wait_qc_ff', 'wait_pack_ff', 'wait_ship_ff', 'wait_dock_ff', 'wait_signoff_ff'];
  const resolveIds = ['resolve_qc_ff', 'resolve_pack_ff', 'resolve_ship_ff', 'resolve_dock_ff', 'resolve_signoff_ff'];
  for (let i = 0; i < 5; i++) {
    manifest.push({ activity_id: escIds[i], title: `Escalate ${STATIONS[i]}`, type: 'worker', tool_source: 'mcp', topic: 'factory_floor', workflow_name: 'escalate_and_wait', mcp_server_id: 'long-tail-human-queue', mcp_tool_name: 'escalate_and_wait', input_mappings: {}, output_fields: ['escalationId', 'signalId'] });
    manifest.push({ activity_id: waitIds[i], title: `Wait ${STATIONS[i]}`, type: 'hook', tool_source: 'signal', topic: 'factory_floor', hook_topic: hookTopics[i], input_mappings: {}, output_fields: [] });
    manifest.push({ activity_id: resolveIds[i], title: `Resolve ${STATIONS[i]}`, type: 'worker', tool_source: 'mcp', topic: 'factory_floor', workflow_name: 'resolve_escalation', mcp_server_id: 'long-tail-human-queue', mcp_tool_name: 'resolve_escalation', input_mappings: {}, output_fields: [] });
  }
  manifest.push({ activity_id: 'complete_ff', title: 'Complete', type: 'worker', tool_source: 'mcp', topic: 'factory_floor', workflow_name: 'get_knowledge', mcp_server_id: 'long-tail-knowledge', mcp_tool_name: 'get_knowledge', input_mappings: {}, output_fields: [] });
  manifest.push({ activity_id: 'done_ff', title: 'Done', type: 'hook', tool_source: 'signal', topic: 'factory_floor', input_mappings: {}, output_fields: [] });
  return manifest;
}

async function main() {
  // 1. Login
  console.log('1. Login');
  const { token } = await api('POST', '/auth/login', { username: 'superadmin', password: 'l0ngt@1l' });
  if (!token) { console.error('Login failed'); process.exit(1); }

  // 2. Deploy workflow
  console.log('2. Deploy factory_floor workflow');
  const yamlContent = readFileSync(join(__dirname, 'yaml/04-factory.yaml'), 'utf-8');
  const existing = await api('GET', '/yaml-workflows?graph_topic=factory_floor&limit=1', undefined, token);
  let wfId: string;

  if (existing?.workflows?.length) {
    wfId = existing.workflows[0].id;
    await api('PUT', `/yaml-workflows/${wfId}`, {
      yaml_content: yamlContent,
      activity_manifest: buildManifest(),
    }, token);
    console.log(`   Updated existing: ${wfId}`);
  } else {
    const created = await api('POST', '/yaml-workflows/direct', {
      name: 'factory_floor',
      description: 'Factory floor: 5 auto + 5 human stations + rollup',
      yaml_content: yamlContent,
      input_schema: { type: 'object', properties: { orderId: { type: 'string' }, product: { type: 'string' } }, required: ['orderId', 'product'] },
      activity_manifest: buildManifest(),
      tags: ['factory', 'test'],
      app_id: 'longtail',
    }, token);
    wfId = created.id;
    console.log(`   Created: ${wfId}`);
  }

  await api('POST', `/yaml-workflows/${wfId}/deploy`, {}, token);
  await sleep(500);
  await api('POST', `/yaml-workflows/${wfId}/activate`, {}, token);
  console.log('   Active\n');

  console.log(`Factory sustained: ${TARGET} orders, ${BATCH_SIZE}/batch every ${ENQUEUE_INTERVAL_MS / 1000}s\n`);

  // State
  const jobIds = new Set<string>();
  let submitted = 0;
  let enqueueDone = false;

  // Escalation tracking: each escalation moves pending → claimed → submitted
  const claimed = new Map<string, { role: string }>(); // id → metadata (ready to resolve)
  const resolvedIds = new Set<string>(); // already submitted for resolution
  let claimCount = 0;
  let resolveCount = 0;
  let completed = 0;
  let peakInFlight = 0;
  const t0 = performance.now();

  // ── Loop 1: Enqueue orders ────────────────────────────────────────
  const enqueueLoop = (async () => {
    while (submitted < TARGET) {
      const batch = Math.min(BATCH_SIZE, TARGET - submitted);
      const promises = Array.from({ length: batch }, (_, i) => {
        const orderId = `ORD-${submitted + i}-${Date.now()}`;
        return api('POST', `/yaml-workflows/${wfId}/invoke`, {
          data: { orderId, product: `widget-${submitted + i}` },
        }, token);
      });
      const results = await Promise.all(promises);
      for (const r of results) {
        if (r?.job_id) jobIds.add(r.job_id);
      }
      submitted += batch;
      const elapsed = ((performance.now() - t0) / 1000).toFixed(1);
      console.log(`[${elapsed}s] Enqueued: ${submitted}/${TARGET}`);
      if (submitted < TARGET) await sleep(ENQUEUE_INTERVAL_MS);
    }
    enqueueDone = true;
    console.log(`[${((performance.now() - t0) / 1000).toFixed(1)}s] All ${TARGET} submitted`);
  })();

  // ── Loop 2: Claim escalations ─────────────────────────────────────
  const claimLoop = (async () => {
    await sleep(2000);
    while (true) {
      try {
        const resp = await api('GET', '/escalations?status=pending&limit=50', undefined, token);
        const pending = resp?.escalations || [];

        for (const esc of pending) {
          // Only claim escalations belonging to our jobs
          if (!jobIds.has(esc.workflow_id)) continue;
          if (!STATIONS.includes(esc.role)) continue;
          if (claimed.has(esc.id) || resolvedIds.has(esc.id)) continue;

          const claimResp = await api('POST', `/escalations/${esc.id}/claim`, {}, token);
          if (claimResp?.error) continue;
          claimed.set(esc.id, { role: esc.role });
          claimCount++;
        }
      } catch { /* transient */ }

      if (claimCount >= TARGET * 5) break;
      await sleep(1000);
    }
  })();

  // ── Loop 3: Resolve claimed escalations ───────────────────────────
  const resolveLoop = (async () => {
    await sleep(3000);
    while (true) {
      // Take all claimed items and submit for resolution
      for (const [escId, meta] of claimed.entries()) {
        if (resolvedIds.has(escId)) continue;
        try {
          await api('POST', `/escalations/${escId}/resolve`, {
            resolverPayload: { approved: true, station: meta.role },
          }, token);
          resolvedIds.add(escId);
          claimed.delete(escId);
          resolveCount++;
        } catch { /* transient */ }
      }

      if (resolveCount >= TARGET * 5) break;
      await sleep(1000);
    }
  })();

  // ── Loop 4: Monitor ───────────────────────────────────────────────
  const monitorLoop = (async () => {
    while (true) {
      await sleep(5000);
      try {
        const running = await api('GET', '/mcp-runs?app_id=longtail&status=running&limit=1&offset=0', undefined, token);
        const runningCount = running?.total ?? 0;
        completed = submitted - runningCount;
        if (completed < 0) completed = 0;
        if (runningCount > peakInFlight) peakInFlight = runningCount;
        const elapsed = ((performance.now() - t0) / 1000).toFixed(1);
        console.log(`[${elapsed}s] Submitted=${submitted} Claimed=${claimCount} Resolved=${resolveCount} Running=${runningCount} Completed=${completed}/${TARGET}  peak=${peakInFlight}`);
      } catch { /* ignore */ }

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
  console.log('Factory Sustained Load — Results');
  console.log(`${'='.repeat(60)}`);
  console.log(`  Target:          ${TARGET} orders`);
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
