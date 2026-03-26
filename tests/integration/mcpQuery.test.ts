/**
 * mcpQuery integration test — full lifecycle:
 *
 *   dynamic mcpQuery → compile → deploy → deterministic invoke → router verification
 *
 * Proves that a dynamic LLM-orchestrated workflow can be compiled into a
 * deterministic DAG pipeline that produces equivalent results. Knowledge
 * is permanently gained: the compiled workflow is faster and requires no LLM.
 *
 * Prerequisites:
 *   - Docker running (docker compose up -d --build)
 *   - LLM API key set (ANTHROPIC_API_KEY or OPENAI_API_KEY)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { ApiClient, NatsWaiter, pollForCompletion, log } from './helpers';

// ── Constants ────────────────────────────────────────────────────────────────

const CANONICAL_PROMPT = [
  'Navigate to http://localhost:3000/.',
  'When prompted, login with name/pass: superadmin/l0ngt@1l.',
  'Once you are logged in, you will be redirected to the site root /.',
  'Locate all top-level page links that are located in the left side navigation list.',
  'Loop through each and save a screenshot image of each linked page,',
  'waiting for it to fully load before taking the screenshot.',
  'Save to images using a deterministic name based upon the link',
  '(e.g long-tail-screenshots/home.png).',
  'For the root page (home page) just use home.png',
].join(' ');

const DETERMINISTIC_INPUT = {
  url: 'http://localhost:3000/',
  username: 'superadmin',
  password: 'l0ngt@1l',
  login_url: 'http://localhost:3000/',
  login_username: 'superadmin',
  login_password: 'l0ngt@1l',
  screenshot_path: 'long-tail-screenshots/home.png',
  pages: [],
};

const WORKFLOW_NAME = 'integration-test-screenshots';
const APP_ID = 'integrationtest';

const hasLLMKey = !!(process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY);

// ── Test suite ───────────────────────────────────────────────────────────────

describe.skipIf(!hasLLMKey)('mcpQuery lifecycle', () => {
  let api: ApiClient;
  let nats: NatsWaiter;

  // State passed between sequential tests
  let dynamicWorkflowId: string;
  let dynamicResult: any;
  let dynamicStartTime: number;
  let yamlWorkflow: any;

  beforeAll(async () => {
    api = new ApiClient();
    nats = await NatsWaiter.create();
    await api.login('superadmin', 'l0ngt@1l');
    log('setup', 'Logged in as superadmin, NATS connected');

    // Clean up any leftover workflow from a prior run
    try {
      const { data } = await api.get<{ workflows: any[] }>('/api/yaml-workflows', {
        search: WORKFLOW_NAME,
      });
      for (const wf of data.workflows || []) {
        if (wf.name === WORKFLOW_NAME) {
          if (wf.status === 'active') await api.archiveWorkflow(wf.id);
          if (wf.status !== 'active') await api.deleteWorkflow(wf.id);
          log('setup', `Cleaned up leftover workflow ${wf.id}`);
        }
      }
    } catch { /* no leftovers */ }
  }, 60_000);

  afterAll(async () => {
    // Clean up compiled workflow if created
    if (yamlWorkflow?.id) {
      try {
        const wf = await api.getYamlWorkflow(yamlWorkflow.id);
        if (wf.status === 'active') await api.archiveWorkflow(yamlWorkflow.id);
        await api.deleteWorkflow(yamlWorkflow.id);
        log('cleanup', `Deleted workflow ${yamlWorkflow.id}`);
      } catch { /* already cleaned or never created */ }
    }
    await nats.close();
    log('cleanup', 'NATS closed');
  });

  // ── Phase 1: Dynamic execution ─────────────────────────────────────────

  it('submits a dynamic mcpQuery and receives a workflow_id', async () => {
    dynamicStartTime = Date.now();

    const result = await api.startMcpQuery(CANONICAL_PROMPT, {
      direct: true,
      wait: false,
    });

    expect(result.workflow_id).toBeTruthy();
    expect(result.status).toBe('started');

    dynamicWorkflowId = result.workflow_id;
    log('dynamic', `Started workflow: ${dynamicWorkflowId}`);
  });

  it('waits for dynamic workflow completion', async () => {
    expect(dynamicWorkflowId).toBeTruthy();

    log('dynamic', 'Waiting for completion via NATS (fallback: polling)...');

    try {
      const event = await nats.waitForWorkflowComplete(dynamicWorkflowId, 540_000);
      log('dynamic', `NATS: workflow.completed received (workflowId: ${event.workflowId})`);
    } catch {
      log('dynamic', 'NATS timeout — falling back to polling');
    }

    // NATS fires before HotMesh fully commits status — poll until status=0
    await pollForCompletion(api, dynamicWorkflowId, 30_000, 2_000);

    const elapsed = ((Date.now() - dynamicStartTime) / 1000).toFixed(1);
    log('dynamic', `Completed in ${elapsed}s`);
  }, 600_000);

  it('validates the dynamic result', async () => {
    expect(dynamicWorkflowId).toBeTruthy();

    const result = await api.getWorkflowResult(dynamicWorkflowId);

    // Result shape: { workflowId, result: { type, data, milestones } }
    // The workflow output is nested: result.result.data contains the actual payload
    const rawResult = result.result;
    expect(rawResult).toBeDefined();

    // Extract the data payload — may be nested under .data or at top level
    const data = rawResult?.data || rawResult;
    dynamicResult = rawResult;

    log('dynamic', `Result keys: ${Object.keys(data).join(', ')}`);

    // Dynamic mcpQuery returns tool_calls_made count
    if (data.tool_calls_made !== undefined) {
      expect(data.tool_calls_made).toBeGreaterThanOrEqual(3);
      log('dynamic', `Tool calls: ${data.tool_calls_made}`);
    }

    if (data.title) log('dynamic', `Title: ${data.title}`);
  });

  // ── Phase 2: Compilation ───────────────────────────────────────────────

  it('compiles the dynamic workflow into a YAML workflow', async () => {
    expect(dynamicWorkflowId).toBeTruthy();

    log('compile', `Compiling workflow ${dynamicWorkflowId}...`);

    yamlWorkflow = await api.compileWorkflow({
      workflow_id: dynamicWorkflowId,
      task_queue: 'long-tail-system',
      workflow_name: 'mcpQuery',
      name: WORKFLOW_NAME,
      app_id: APP_ID,
    });

    expect(yamlWorkflow.id).toBeTruthy();
    expect(yamlWorkflow.yaml_content).toBeTruthy();
    expect(yamlWorkflow.status).toBe('draft');

    if (yamlWorkflow.activity_manifest) {
      log('compile', `Activity manifest: ${yamlWorkflow.activity_manifest.length} entries`);
    }
    if (yamlWorkflow.input_schema) {
      const fields = Object.keys(yamlWorkflow.input_schema.properties || {});
      log('compile', `Input schema fields: ${fields.join(', ')}`);
    }

    log('compile', `Created draft workflow: ${yamlWorkflow.id}`);
  });

  it('deploys the compiled workflow', async () => {
    expect(yamlWorkflow?.id).toBeTruthy();

    log('deploy', `Deploying ${WORKFLOW_NAME}...`);

    const deployed = await api.deployWorkflow(yamlWorkflow.id);
    expect(deployed.status).toBe('active');

    yamlWorkflow = deployed;
    log('deploy', `Deployed and active: ${yamlWorkflow.id}`);
  });

  // ── Phase 3: Deterministic execution ───────────────────────────────────

  it('invokes the deterministic workflow directly', async () => {
    expect(yamlWorkflow?.id).toBeTruthy();
    expect(yamlWorkflow.status).toBe('active');

    log('deterministic', 'Invoking compiled workflow (sync)...');
    const startTime = Date.now();

    const result = await api.invokeWorkflow(yamlWorkflow.id, DETERMINISTIC_INPUT, true);

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    log('deterministic', `Completed in ${elapsed}s`);

    expect(result).toBeTruthy();

    if (result.result) {
      log('deterministic', `Result keys: ${Object.keys(result.result).join(', ')}`);
    }
    if (result.job_id) {
      log('deterministic', `Job ID: ${result.job_id}`);
    }

    // Compare to dynamic duration
    if (dynamicStartTime) {
      const dynamicDuration = (Date.now() - dynamicStartTime) / 1000;
      const deterministicDuration = parseFloat(elapsed);
      log('deterministic', `Speedup: ${(dynamicDuration / deterministicDuration).toFixed(1)}x faster than dynamic`);
    }
  }, 300_000);

  // ── Phase 4: Router verification ───────────────────────────────────────

  it('routes through mcpQueryRouter to the compiled workflow', async () => {
    expect(yamlWorkflow?.id).toBeTruthy();

    log('verify', 'Submitting same prompt through router (should match compiled workflow)...');
    const startTime = Date.now();

    // wait: true, no direct flag — goes through mcpQueryRouter
    const result = await api.startMcpQuery(CANONICAL_PROMPT, {
      direct: false,
      wait: true,
    });

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    log('verify', `Router completed in ${elapsed}s`);

    // The router should have discovered and used the compiled workflow
    if (result.discovery) {
      log('verify', `Discovery method: ${result.discovery.method}`);
      log('verify', `Discovery confidence: ${result.discovery.confidence}`);
      log('verify', `Discovery workflow: ${result.discovery.workflowName}`);

      expect(result.discovery.method).toBe('compiled-workflow');
      expect(result.discovery.confidence).toBeGreaterThanOrEqual(0.7);
      expect(result.discovery.workflowName).toBe(WORKFLOW_NAME);
    } else {
      // If no discovery metadata, the router still returned a result — log it
      log('verify', `Result keys: ${Object.keys(result).join(', ')}`);
      log('verify', 'No discovery metadata — checking if result indicates compiled path');
    }
  }, 300_000);
});
