import { randomUUID } from 'crypto';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client as Postgres } from 'pg';
import { Durable } from '@hotmeshio/hotmesh';

import { postgres_options, sleepFor } from '../setup';
import { migrate } from '../../lib/db/migrate';
import { getPool } from '../../lib/db';
import * as escalationService from '../../services/escalation';
import * as userService from '../../services/user';
import { accumulateItemByMetadata } from '../../api/escalations/accumulate';
import { rollupBin, rollupMember } from '../../examples/workflows/rollup-bin';
import type { LTEscalationRecord } from '../../types';

const { Connection, Client, Worker } = Durable;
const TASK_QUEUE = 'test-container-selector';

// Slots (accumulators of one) share the box's role and facet. A narrowed
// container selector lands the add in the box, never in a sibling slot, and
// an item's own row is never its container.
const ROLE = `filling-${randomUUID().slice(0, 8)}`;

describe('accumulate by metadata with a container selector (ask 0)', () => {
  let client: InstanceType<typeof Client>;
  let operatorId: string;
  const started: { workflowName: string; workflowId: string }[] = [];

  async function waitFor(signalKey: string): Promise<LTEscalationRecord> {
    const deadline = Date.now() + 15_000;
    for (;;) {
      const row = await escalationService.getEscalationBySignalKey(signalKey);
      if (row) return row;
      if (Date.now() > deadline) throw new Error(`no escalation for ${signalKey}`);
      await sleepFor(200);
    }
  }

  async function park(workflowName: 'rollupBin' | 'rollupMember', data: Record<string, unknown>, signalKey: string) {
    const workflowId = `${workflowName}-${Durable.guid()}`;
    started.push({ workflowName, workflowId });
    await client.workflow.start({
      args: [{ data: { role: ROLE, ...data } }], taskQueue: TASK_QUEUE, workflowName, workflowId, expire: 300,
    });
    return waitFor(signalKey);
  }

  const countOf = async (id: string) => (await escalationService.getEscalation(id))?.metadata?.accumulate_count;
  const auth = () => ({ userId: operatorId });

  beforeAll(async () => {
    await Connection.connect({ class: Postgres, options: postgres_options });
    await migrate();
    operatorId = (await userService.createUser({
      external_id: `container-selector-${Date.now()}`,
      email: 'container-selector@example.com',
      roles: [{ role: 'superadmin', type: 'superadmin' }],
    })).id;
    const connection = { class: Postgres, options: postgres_options };
    for (const workflow of [rollupBin, rollupMember]) {
      const worker = await Worker.create({ connection, taskQueue: TASK_QUEUE, workflow });
      await worker.run();
    }
    client = new Client({ connection });
  }, 30_000);

  afterAll(async () => {
    for (const { workflowName, workflowId } of started) {
      await client.workflow.getHandle(TASK_QUEUE, workflowName, workflowId).then((h) => h.terminate()).catch(() => undefined);
    }
    await getPool().query('DELETE FROM public.hmsh_escalations WHERE role = $1', [ROLE]);
    await userService.deleteUser(operatorId);
    await sleepFor(500);
    await Durable.shutdown();
  }, 30_000);

  it('with no box open, a narrowed add finds no container and leaves the sibling slot alone', async () => {
    const binKey = `K-${randomUUID()}`;
    const mine = await park('rollupMember', { orderId: `A-${binKey}`, binKey }, `bag-A-${binKey}`);
    const sibling = await park('rollupMember', { orderId: `B-${binKey}`, binKey }, `bag-B-${binKey}`);

    const result = await accumulateItemByMetadata({
      key: 'binKey', value: binKey, itemKey: `A-${binKey}`, restrictRoles: [ROLE],
      container: { subtypes: ['bin'] }, reciprocal: { id: mine.id },
    }, auth());
    expect(result.status).toBe(404);
    expect(await countOf(sibling.id)).toBe(0);
    expect(await countOf(mine.id)).toBe(0);
  }, 30_000);

  it('a narrowed add lands in the box and writes the slot as its reciprocal', async () => {
    const binKey = `K-${randomUUID()}`;
    const mine = await park('rollupMember', { orderId: `A-${binKey}`, binKey }, `bag-A-${binKey}`);
    const sibling = await park('rollupMember', { orderId: `B-${binKey}`, binKey }, `bag-B-${binKey}`);
    const box = await park('rollupBin', { binKey, max: 4 }, `bin-${binKey}`);

    const result = await accumulateItemByMetadata({
      key: 'binKey', value: binKey, itemKey: `A-${binKey}`, restrictRoles: [ROLE],
      container: { subtypes: ['bin'] }, reciprocal: { id: mine.id },
    }, auth());
    expect(result.status).toBe(200);
    expect(result.data.escalationId).toBe(box.id);
    expect(await countOf(box.id)).toBe(1);
    expect(await countOf(sibling.id)).toBe(0);
  }, 30_000);

  it('the item row is never its own container, even when the selector admits it', async () => {
    const binKey = `K-${randomUUID()}`;
    const mine = await park('rollupMember', { orderId: `A-${binKey}`, binKey }, `bag-A-${binKey}`);

    const result = await accumulateItemByMetadata({
      key: 'binKey', value: binKey, itemKey: `A-${binKey}`, restrictRoles: [ROLE],
      container: { subtypes: ['bag'] }, reciprocal: { id: mine.id },
    }, auth());
    expect(result.status).toBe(404);
    expect(await countOf(mine.id)).toBe(0);
  }, 30_000);

  it('initiatedBy is stored as the entry actor; the caller stays resolved_by', async () => {
    const person = (await userService.createUser({
      external_id: `initiator-${Date.now()}`, email: 'initiator@example.com', roles: [],
    })).id;
    try {
      const binKey = `K-${randomUUID()}`;
      const box = await park('rollupBin', { binKey, max: 4 }, `bin-${binKey}`);
      const result = await accumulateItemByMetadata({
        key: 'binKey', value: binKey, itemKey: 'bag-1', restrictRoles: [ROLE], initiatedBy: person,
      }, auth());
      expect(result.status).toBe(200);
      const row = await escalationService.getEscalation(box.id);
      const entry = JSON.parse(row!.envelope).accumulate_items['bag-1'];
      expect(entry.actor).toBe(person);
      expect(row!.metadata?.resolved_by).toBe(operatorId);
    } finally {
      await userService.deleteUser(person);
    }
  }, 30_000);

  it('a malformed selector is refused before any read', async () => {
    const result = await accumulateItemByMetadata({
      key: 'binKey', value: 'x', itemKey: 'y', container: { types: 'matchBox' as any },
    }, auth());
    expect(result).toEqual({ status: 400, error: 'container.types must be an array of strings' });
  });
});
