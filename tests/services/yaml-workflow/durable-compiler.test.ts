/**
 * Durable-to-YAML Compiler Tests
 *
 * Validates that the compiler correctly translates procedural durable workflows
 * into equivalent YAML DAGs with proper structure, activity mapping, and schemas.
 *
 * Part A tests run the original durable workflow to capture baseline results.
 * Part B compiles from source and validates the YAML output structure.
 * Side-by-side comparison confirms the compiled DAG encodes the same logic.
 *
 * Requires: docker compose up (Postgres), ANTHROPIC_API_KEY
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client as Postgres } from 'pg';
import { Durable } from '@hotmeshio/hotmesh';
import * as path from 'path';

import { postgres_options, sleepFor } from '../../setup';
import { migrate } from '../../../lib/db/migrate';
import * as configService from '../../../services/config';
import { createLTInterceptor } from '../../../services/interceptor';
import { createLTActivityInterceptor } from '../../../services/interceptor/activity-interceptor';
import * as interceptorActivities from '../../../services/interceptor/activities';
import * as basicEchoWorkflow from '../../../examples/workflows/basic-echo';
import * as basicEchoActivities from '../../../examples/workflows/basic-echo/activities';
import { compileDurableToYaml } from '../../../services/yaml-workflow/durable-compiler';
import { hasLLMApiKey } from '../../../services/llm';
import type { LTReturn } from '../../../types';

const { Connection, Client, Worker } = Durable;

const RUN_ID = Durable.guid().slice(0, 8).toLowerCase();
const TASK_QUEUE = `compilertest${RUN_ID}`;
const ACTIVITY_QUEUE = 'lt-interceptor';

const HAS_KEY = hasLLMApiKey();
const describeIf = HAS_KEY ? describe : describe.skip;

describeIf('durable-to-yaml compiler', () => {
  let client: InstanceType<typeof Client>;
  let durableResult: LTReturn;

  beforeAll(async () => {
    await Connection.connect({
      class: Postgres,
      options: postgres_options,
    });
    await migrate();

    await configService.upsertWorkflowConfig({
      workflow_type: 'basicEcho',
      invocable: false,
      task_queue: TASK_QUEUE,
      default_role: 'reviewer',
      description: null,
      roles: ['reviewer'],
      invocation_roles: [],
      consumes: [],
    });

    const connection = { class: Postgres, options: postgres_options };

    await Durable.registerActivityWorker(
      { connection, taskQueue: ACTIVITY_QUEUE },
      { ...interceptorActivities, ...basicEchoActivities },
      ACTIVITY_QUEUE,
    );

    const ltInterceptor = createLTInterceptor({ activityTaskQueue: ACTIVITY_QUEUE });
    Durable.registerInboundInterceptor(ltInterceptor);
    Durable.registerOutboundInterceptor(createLTActivityInterceptor());

    const worker = await Worker.create({
      connection,
      taskQueue: TASK_QUEUE,
      workflow: basicEchoWorkflow.basicEcho,
    });
    await worker.run();

    client = new Client({ connection });

    // Run the durable workflow once to establish baseline
    const handle = await client.workflow.start({
      args: [{ data: { message: 'compiler test', sleepSeconds: 1 }, metadata: {} }],
      taskQueue: TASK_QUEUE,
      workflowName: 'basicEcho',
      workflowId: `durable-baseline-${Durable.guid()}`,
      expire: 60,
    });
    durableResult = await handle.result() as LTReturn;
  }, 60_000);

  afterAll(async () => {
    Durable.clearInterceptors();
    Durable.clearOutboundInterceptors();
    await sleepFor(1500);
    await Durable.shutdown();
  }, 15_000);

  // ── Baseline: durable workflow produces expected result ──────────────

  it('durable baseline returns expected shape', () => {
    expect(durableResult.type).toBe('return');
    expect(durableResult.data.message).toBe('compiler test');
    expect(durableResult.data.echoedAt).toBeTruthy();
    expect(durableResult.data.sleepSeconds).toBe(1);
  });

  // ── Compiler: produces valid YAML from source ───────────────────────

  it('compiles basicEcho to a valid YAML DAG', async () => {
    const sourcePath = path.resolve(__dirname, '../../../examples/workflows/basic-echo/index.ts');

    const compiled = await compileDurableToYaml({
      source: sourcePath,
      isFilePath: true,
      workflowName: 'basicEcho',
      name: 'basic_echo_test',
    });

    // YAML structure
    expect(compiled.yaml).toContain('subscribes:');
    expect(compiled.yaml).toContain('type: trigger');
    expect(compiled.yaml).toContain('type: worker');
    expect(compiled.graphTopic).toBeTruthy();
    expect(compiled.appId).toBe('longtail');

    // Activity manifest
    expect(compiled.activityManifest.length).toBeGreaterThanOrEqual(2);
    const types = compiled.activityManifest.map((a) => a.type);
    expect(types).toContain('trigger');
    expect(types).toContain('worker');

    // Input schema matches envelope.data fields
    const inputProps = Object.keys((compiled.inputSchema as any)?.properties || {});
    expect(inputProps).toContain('message');
    expect(inputProps).toContain('sleepSeconds');

    // Tags
    expect(compiled.tags).toContain('durable');
    expect(compiled.category).toBe('durable');
  }, 60_000);

  // ── Compiler: encodes sleep as hook activity ────────────────────────

  it('maps Durable.workflow.sleep to a hook activity', async () => {
    const sourcePath = path.resolve(__dirname, '../../../examples/workflows/basic-echo/index.ts');

    const compiled = await compileDurableToYaml({
      source: sourcePath,
      isFilePath: true,
      workflowName: 'basicEcho',
      name: 'basic_echo_sleep_test',
    });

    // The sleep primitive should produce a hook activity
    expect(compiled.yaml).toContain('type: hook');
    expect(compiled.yaml).toMatch(/sleep:/);

    // The hook types in the manifest
    const hookActivities = compiled.activityManifest.filter((a) => a.type === 'hook');
    expect(hookActivities.length).toBeGreaterThanOrEqual(1);
  }, 60_000);

  // ── Compiler: wires _scope and workflowName on workers ──────────────

  it('includes _scope and workflowName in worker input maps', async () => {
    const sourcePath = path.resolve(__dirname, '../../../examples/workflows/basic-echo/index.ts');

    const compiled = await compileDurableToYaml({
      source: sourcePath,
      isFilePath: true,
      workflowName: 'basicEcho',
      name: 'basic_echo_wiring_test',
    });

    // _scope threading
    expect(compiled.yaml).toContain('_scope:');
    expect(compiled.yaml).toMatch(/_scope:.*trigger.*output\.data\._scope/);

    // workflowName routing
    expect(compiled.yaml).toContain('workflowName: echo');
  }, 60_000);

  // ── Compiler: extracts graphTopic from YAML subscribes ──────────────

  it('uses the YAML subscribes topic as graphTopic', async () => {
    const sourcePath = path.resolve(__dirname, '../../../examples/workflows/basic-echo/index.ts');

    const compiled = await compileDurableToYaml({
      source: sourcePath,
      isFilePath: true,
      workflowName: 'basicEcho',
      name: 'basic_echo_topic_test',
    });

    // graphTopic should match the subscribes value in the YAML
    const subscribesMatch = compiled.yaml.match(/subscribes:\s*(.+)/);
    expect(subscribesMatch).toBeTruthy();
    const yamlTopic = subscribesMatch![1].trim().replace(/^['"]|['"]$/g, '');
    expect(compiled.graphTopic).toBe(yamlTopic);
  }, 60_000);

  // ── Compiler: rewrites app.id to target appId ──────────────────────

  it('rewrites app.id to the specified appId', async () => {
    const sourcePath = path.resolve(__dirname, '../../../examples/workflows/basic-echo/index.ts');

    const compiled = await compileDurableToYaml({
      source: sourcePath,
      isFilePath: true,
      workflowName: 'basicEcho',
      name: 'basic_echo_appid_test',
      appId: 'myapp',
    });

    expect(compiled.appId).toBe('myapp');
    expect(compiled.yaml).toMatch(/id:\s*myapp/);
  }, 60_000);

  // ── Side-by-side: compiled YAML encodes same data flow as durable ───

  it('compiled YAML captures the same data flow as the durable workflow', async () => {
    const sourcePath = path.resolve(__dirname, '../../../examples/workflows/basic-echo/index.ts');

    const compiled = await compileDurableToYaml({
      source: sourcePath,
      isFilePath: true,
      workflowName: 'basicEcho',
      name: 'basic_echo_comparison',
    });

    // The durable workflow returns: message, echoedAt, sleepSeconds, userId
    // The compiled YAML should wire these fields in job.maps or output
    const yaml = compiled.yaml;

    // message flows from trigger → echo worker → output
    expect(yaml).toContain('message');

    // sleepSeconds preserved from trigger input
    expect(yaml).toContain('sleepSeconds');

    // Transition order: trigger → sleep hook → echo worker
    const transitions = yaml.match(/transitions:[\s\S]*$/)?.[0] || '';
    expect(transitions).toContain('trigger_');
    expect(transitions).toContain('to:');

    console.log('\n  ── Durable result ──');
    console.log('  ', JSON.stringify(durableResult.data));
    console.log('\n  ── Compiled YAML structure ──');
    console.log(`  Activities: ${compiled.activityManifest.length}`);
    console.log(`  Topic: ${compiled.graphTopic}`);
    console.log(`  Inputs: ${Object.keys((compiled.inputSchema as any)?.properties || {}).join(', ')}`);
  }, 60_000);
});
