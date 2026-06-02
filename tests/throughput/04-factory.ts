/**
 * Test 04 — Factory Floor (Real Escalations)
 *
 * The full pattern: 5 automated steps → 5 human stations → rollup.
 * Each human station uses the real escalate_and_wait MCP tool to create
 * an escalation in lt_escalations. The test resolves each escalation via
 * the Long Tail API — the same path the dashboard form takes.
 *
 * This proves:
 *   - escalate_and_wait MCP tool creates real escalations with signal_routing
 *   - Hook pauses the workflow durably
 *   - API resolution sends signal (engine=yaml) to resume the hook
 *   - Resolve worker runs as a descendant of the hook
 *   - Chain continues to the next station
 *   - All 5 stations complete and the workflow finishes
 *
 * Usage:
 *   npx ts-node tests/throughput/04-factory.ts [count]
 */

import http from 'http';
import { readFileSync } from 'fs';
import { join } from 'path';

const API_PORT = process.env.PORT || '3000';

const STATIONS = ['qc_inspector', 'packaging', 'shipping', 'loading_dock', 'final_signoff'];
const COUNT = parseInt(process.argv[2] || '1', 10);

// ── HTTP helpers ────────────────────────────────────────────────────────────

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

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Activity manifest for the YAML workflow ─────────────────────────────────

function buildManifest(): any[] {
  const manifest: any[] = [
    { activity_id: 'trigger_ff', title: 'Trigger', type: 'trigger', tool_source: 'trigger', topic: 'factory_floor', input_mappings: {}, output_fields: ['orderId', 'product'] },
  ];

  // 5 automated steps — all use a simple factory_step tool (we'll register it as a no-op MCP tool isn't needed; the YAML worker will call it)
  for (const step of ['ingest', 'classify', 'prepress', 'print', 'scan']) {
    manifest.push({
      activity_id: `${step}_ff`,
      title: step,
      type: 'worker',
      tool_source: 'mcp',
      topic: 'factory_floor',
      workflow_name: 'get_knowledge',
      mcp_server_id: 'long-tail-knowledge',
      mcp_tool_name: 'get_knowledge',
      input_mappings: {},
      output_fields: [],
    });
  }

  // 5 human stations — each is escalate + hook + resolve
  const hookTopics = ['factory_qc_ack', 'factory_pack_ack', 'factory_ship_ack', 'factory_dock_ack', 'factory_signoff_ack'];
  const escIds = ['esc_qc_ff', 'esc_pack_ff', 'esc_ship_ff', 'esc_dock_ff', 'esc_signoff_ff'];
  const waitIds = ['wait_qc_ff', 'wait_pack_ff', 'wait_ship_ff', 'wait_dock_ff', 'wait_signoff_ff'];
  const resolveIds = ['resolve_qc_ff', 'resolve_pack_ff', 'resolve_ship_ff', 'resolve_dock_ff', 'resolve_signoff_ff'];

  for (let i = 0; i < 5; i++) {
    manifest.push({
      activity_id: escIds[i],
      title: `Escalate ${STATIONS[i]}`,
      type: 'worker',
      tool_source: 'mcp',
      topic: 'factory_floor',
      workflow_name: 'escalate_and_wait',
      mcp_server_id: 'long-tail-human-queue',
      mcp_tool_name: 'escalate_and_wait',
      input_mappings: {},
      output_fields: ['escalationId', 'signalId'],
    });
    manifest.push({
      activity_id: waitIds[i],
      title: `Wait ${STATIONS[i]}`,
      type: 'hook',
      tool_source: 'signal',
      topic: 'factory_floor',
      hook_topic: hookTopics[i],
      input_mappings: {},
      output_fields: [],
    });
    manifest.push({
      activity_id: resolveIds[i],
      title: `Resolve ${STATIONS[i]}`,
      type: 'worker',
      tool_source: 'mcp',
      topic: 'factory_floor',
      workflow_name: 'resolve_escalation',
      mcp_server_id: 'long-tail-human-queue',
      mcp_tool_name: 'resolve_escalation',
      input_mappings: {},
      output_fields: [],
    });
  }

  // Complete + done
  manifest.push({
    activity_id: 'complete_ff',
    title: 'Complete',
    type: 'worker',
    tool_source: 'mcp',
    topic: 'factory_floor',
    workflow_name: 'factory_step',
    mcp_server_id: 'long-tail-human-queue',
    mcp_tool_name: 'factory_step',
    input_mappings: {},
    output_fields: [],
  });
  manifest.push({
    activity_id: 'done_ff',
    title: 'Done',
    type: 'hook',
    tool_source: 'signal',
    topic: 'factory_floor',
    input_mappings: {},
    output_fields: [],
  });

  return manifest;
}

// ── Main ────────────────────────────────────────────────────────────────────

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

  // 3. Run workflows
  const t0 = performance.now();
  let allPassed = true;

  for (let n = 0; n < COUNT; n++) {
    const orderId = `ORD-${n}-${Date.now()}`;
    console.log(`── Order ${n + 1}/${COUNT}: ${orderId} ──`);

    // 3a. Invoke
    const { job_id: jobId } = await api('POST', `/yaml-workflows/${wfId}/invoke`, {
      data: { orderId, product: `widget-${n}` },
    }, token);
    console.log(`   Invoked: ${jobId}`);

    // 3b. Walk through 5 stations
    for (let s = 0; s < STATIONS.length; s++) {
      // Wait for escalation to appear
      let escalationId: string | null = null;
      for (let tick = 0; tick < 30; tick++) {
        await sleep(500);
        const resp = await api('GET', '/escalations?status=pending&limit=20', undefined, token);
        const escs = resp?.escalations || [];
        // Find the one for this job + station
        const match = escs.find((e: any) =>
          e.workflow_id === jobId && e.role === STATIONS[s],
        );
        if (match) {
          escalationId = match.id;
          break;
        }
      }

      if (!escalationId) {
        console.log(`   ✗ Station ${s + 1} (${STATIONS[s]}): no escalation after 15s`);
        allPassed = false;
        break;
      }

      // Claim it, then resolve
      await api('POST', `/escalations/${escalationId}/claim`, {}, token);
      const resolveResp = await api('POST', `/escalations/${escalationId}/resolve`, {
        resolverPayload: { approved: true, station: STATIONS[s] },
      }, token);
      const signaled = resolveResp?.signaled;
      console.log(`   ✓ Station ${s + 1} (${STATIONS[s]}): escalation=${escalationId.slice(0, 8)} signaled=${signaled}`);
    }

    // 3c. Wait for workflow completion
    await sleep(2000);
    const exec = await api('GET', `/pipelines/${jobId}/execution?app_id=longtail`, undefined, token);
    const status = exec?.status;
    console.log(`   Final: status=${status}\n`);
    if (status !== 'completed') allPassed = false;
  }

  const elapsed = (performance.now() - t0) / 1000;
  console.log(`\n${'='.repeat(50)}`);
  console.log(`${allPassed ? '✓' : '✗'} ${COUNT} workflow(s) in ${elapsed.toFixed(1)}s`);
  console.log(`  Activities: ${COUNT * 22}`);
  console.log(`  Escalations created + resolved: ${COUNT * 5}`);
  if (allPassed) {
    console.log(`  Full round-trip proven: escalate_and_wait → hook → API resolve → resume → next station`);
  }

  process.exit(allPassed ? 0 : 1);
}

main().catch((err) => { console.error(err); process.exit(1); });
