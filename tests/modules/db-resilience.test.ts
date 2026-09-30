import { spawn } from 'child_process';
import path from 'path';

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { ConnectionHealth } from '@hotmeshio/hotmesh';

import { start } from '../../start';
import { createClient } from '../../sdk';
import { getConnection, getPool } from '../../lib/db';
import { searchByFacets } from '../../services/escalation/facets';
import type { LTInstance } from '../../types/startup';
import {
  TEST_DB,
  beginOutage,
  createCrashGuard,
  endOutage,
  terminateBackends,
  waitFor,
} from '../setup/chaos';

import { resilienceEcho } from './fixtures/resilience-workflow';

const TASK_QUEUE = 'lt-resilience';

/**
 * Long Tail against a database that restarts and refuses connections: the
 * process never exits, and every surface works again once the database returns.
 */
describe('database resilience', () => {
  const guard = createCrashGuard();
  let lt: LTInstance;

  const sdk = () => createClient({ auth: { userId: lt.adminUserId! } });

  const runEcho = async (name: string) => {
    const handle = await lt.client.workflow.start({
      args: [name],
      taskQueue: TASK_QUEUE,
      workflowName: 'resilienceEcho',
      workflowId: `resilience-${name}-${Date.now()}`,
      expire: 120,
    });
    return handle.result();
  };

  const recovered = () =>
    waitFor(async () => (await sdk().escalations.list({ limit: 1 })).status === 200, 30_000, 'escalations after restore');

  beforeAll(async () => {
    guard.install();
    lt = await start({
      database: TEST_DB,
      server: { enabled: false },
      seed: { admin: { externalId: 'resilience-admin', displayName: 'Resilience Admin', email: 'resilience@longtail.local' } },
      workers: [{ taskQueue: TASK_QUEUE, workflow: resilienceEcho }],
    });
  }, 60_000);

  afterEach(async () => {
    await endOutage();
    await waitFor(() => ConnectionHealth.snapshot().state === 'up', 30_000, 'HotMesh connections up');
    expect(guard.crashes).toEqual([]);
  }, 45_000);

  afterAll(async () => {
    await endOutage();
    await lt.shutdown();
    guard.uninstall();
  }, 60_000);

  it('recovers facet search when its first call lands during an outage', async () => {
    await beginOutage();
    await expect(searchByFacets({ limit: 1 })).rejects.toBeDefined();
    await endOutage();
    await waitFor(async () => Array.isArray((await searchByFacets({ limit: 1 })).escalations), 30_000, 'facet search');
  }, 60_000);

  it('keeps running when every session is terminated, and serves calls and workflows after', async () => {
    expect(await runEcho('before')).toBe('echo:before');
    expect(await terminateBackends()).toBeGreaterThan(0);
    await recovered();
    expect((await sdk().users.list({ limit: 1 })).status).toBe(200);
    expect(await runEcho('after')).toBe('echo:after');
  }, 60_000);

  it('keeps running through an outage window and recovers when it ends', async () => {
    await beginOutage();
    await new Promise((resolve) => setTimeout(resolve, 3_000));
    await endOutage();
    await recovered();
    expect(await runEcho('after-outage')).toBe('echo:after-outage');
  }, 60_000);

  it('survives a checked-out pool client losing its socket', async () => {
    const client = await getPool().connect();
    try {
      await terminateBackends();
      await expect(client.query('SELECT 1')).rejects.toBeInstanceOf(Error);
    } finally {
      client.release(true);
    }
    await waitFor(async () => (await getPool().query('SELECT 1 AS ok')).rows[0].ok === 1, 10_000, 'pool query');
  }, 30_000);

  it('hands out clients that carry an error listener from construction', async () => {
    const { class: GuardedClient, options } = getConnection();
    const client = new GuardedClient(options);
    expect(client.listenerCount('error')).toBe(1);
    await client.connect();
    try {
      await terminateBackends();
      await expect(client.query('SELECT 1')).rejects.toBeInstanceOf(Error);
    } finally {
      await client.end().catch(() => undefined);
    }
  }, 30_000);

  it('keeps a Long Tail process alive through a restart and serves the next call', async () => {
    const probe = path.join(__dirname, 'fixtures', 'resilience-probe.ts');
    const child = spawn('npx', ['ts-node', '--transpile-only', probe], {
      cwd: path.join(__dirname, '..', '..'),
      env: { ...process.env, NODE_ENV: 'test' },
    });
    let output = '';
    child.stdout.on('data', (chunk) => (output += chunk.toString()));
    child.stderr.on('data', (chunk) => (output += chunk.toString()));
    const exited = new Promise<number | null>((resolve) => child.on('exit', resolve));
    try {
      await waitFor(() => output.includes('probe-ready'), 60_000, 'probe ready');
      expect(await terminateBackends()).toBeGreaterThan(0);
      const outcome = await Promise.race([exited, new Promise((resolve) => setTimeout(() => resolve('alive'), 3_000))]);
      expect(outcome).toBe('alive');
      await waitFor(async () => {
        child.stdin.write('call\n');
        await new Promise((resolve) => setTimeout(resolve, 500));
        return output.includes('probe-status:200');
      }, 30_000, 'call after restart');
    } finally {
      child.kill('SIGKILL');
    }
  }, 120_000);
});
