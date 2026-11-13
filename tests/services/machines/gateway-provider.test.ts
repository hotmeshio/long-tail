import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { Client as Postgres } from 'pg';
import { Durable } from '@hotmeshio/hotmesh';

import { postgres_options } from '../../setup';
import { migrate } from '../../../lib/db/migrate';
import { getPool } from '../../../lib/db';
import { DurableRelay, durableProviderRegistry, openWait } from '../../../services/durable-provider';
import { CONTROLLER } from '../../../services/machines/gateway/actions';
import { ApiLineEscalations } from '../../../services/machines/gateway/api-escalations';
import { ensureLineBots } from '../../../services/machines/identities';
import { deleteUser } from '../../../services/user/crud';
import { DEFAULT_LINE } from '../../../examples/workflows/machine-line/line';
import { commandRow, commandTarget } from '../../../services/machines/workflow-contracts';
import { FakeDurableProvider } from '../../helpers/fake-durable-provider';

// The machine gateway resolves the rows a Temporal or DBOS line workflow
// waits on, and the relay delivers each outcome to the workflow.
vi.mock('../../../lib/events/publish', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/events/publish')>()),
  publishWorkflowEvent: vi.fn().mockResolvedValue(undefined),
}));

const PROVIDER = 'gateway-provider-test';
const RUN = `gw-${Date.now()}`;
const LINE = { ...structuredClone(DEFAULT_LINE), lineId: `line-${Date.now().toString(36)}` };

describe('the machine gateway on provider waits', () => {
  const provider = new FakeDurableProvider(PROVIDER);
  const relay = new DurableRelay(provider, { reconcileMs: 0 });
  const users = new Map<string, string>();
  let lt: ApiLineEscalations;
  let creator: string;

  beforeAll(async () => {
    await Durable.Connection.connect({ class: Postgres, options: postgres_options });
    await migrate();
    for (const [actor, id] of await ensureLineBots(LINE)) users.set(actor, id);
    creator = users.get(CONTROLLER)!;
    durableProviderRegistry.register(provider);
    lt = new ApiLineEscalations((as) => users.get(as) ?? creator);
  }, 60_000);

  afterAll(async () => {
    durableProviderRegistry.clear();
    for (const id of new Set(users.values())) await deleteUser(id);
    const pool = getPool();
    await pool.query(`DELETE FROM public.hmsh_escalations WHERE id IN (SELECT escalation_id FROM lt_durable_waits WHERE provider = $1)`, [PROVIDER]);
    await pool.query('DELETE FROM lt_durable_waits WHERE provider = $1', [PROVIDER]);
    await Durable.shutdown();
  });

  it('resolves a command row with the machine reply and delivers it', async () => {
    const machineId = LINE.machines[0].machineId;
    const row = commandRow(commandTarget(LINE, machineId), 'start');
    const { escalation } = await openWait(PROVIDER, { workflowId: `${RUN}-cmd`, waitKey: 'start', ...row }, creator);

    const reply = { status: 'completed', op: 'start' };
    expect((await lt.resolve(CONTROLLER, escalation.id, reply)).outcome).toBe('done');
    await relay.run();
    const delivered = provider.deliveries.find((d) => d.ref.workflowId === `${RUN}-cmd`);
    expect(delivered?.outcome).toMatchObject({ status: 'resolved', data: reply });
  });

  it('adds hop items to a provider accumulator and delivers them at the count', async () => {
    const { escalation } = await openWait(PROVIDER, {
      workflowId: `${RUN}-hop`, waitKey: 'hop', role: commandTarget(LINE, LINE.machines[1].machineId).role, type: 'handoff', accumulate: { max: 2 },
    }, creator);

    expect((await lt.accumulate(CONTROLLER, escalation.id, 'unit-1', { arrived: true })).outcome).toBe('done');
    expect((await lt.accumulate(CONTROLLER, escalation.id, 'unit-2', { arrived: true })).outcome).toBe('done');
    await relay.run();
    const delivered = provider.deliveries.find((d) => d.ref.workflowId === `${RUN}-hop`);
    expect(delivered?.outcome.data).toMatchObject({ $trigger: 'count', $accumulated: [expect.objectContaining({ itemKey: 'unit-1' }), expect.objectContaining({ itemKey: 'unit-2' })] });
  });
});
