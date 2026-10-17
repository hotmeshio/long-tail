import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client as Postgres } from 'pg';
import { Durable } from '@hotmeshio/hotmesh';

import { postgres_options, sleepFor } from '../setup';
import { connectTelemetry, disconnectTelemetry } from '../setup/telemetry';
import { migrate } from '../../lib/db/migrate';
import * as escalationService from '../../services/escalation';
import * as userService from '../../services/user';
import { eventRegistry } from '../../lib/events';
import { systemEventsConfig } from '../../lib/events/system-events';
import { machineCommand, commandSignalKey } from '../../examples/workflows/machine-line';
import { commandTarget } from '../../services/machines/commands';
import { MachineGateway } from '../../services/machines/gateway/gateway';
import { silentLog } from '../../services/machines/gateway/log';
import { ensureLineBots } from '../../services/machines/identities';
import { CallbackEventAdapter } from '../../lib/events/callback';
import { DEFAULT_LINE } from '../../examples/workflows/machine-line/line';
import { MODE, lineFilter } from '../../lib/machines/protocol';
import { CallbackEscalationFeed, MemoryMachineBus } from '../../lib/machines/transport';
import { ApiLineEscalations } from '../../services/machines/gateway/api-escalations';
import { ROOT, startHarness, until, type Harness } from '../helpers/machine-line-fixtures';

const { Connection, Client, Worker } = Durable;
const TASK_QUEUE = 'test-machine-command';
const LINE = { ...structuredClone(DEFAULT_LINE), lineId: `line-${Date.now().toString(36)}` };

// A workflow step asks a machine for a command through the real orchestrator:
// it parks a machine-command row; the gateway sends the command over the mock
// line and resolves the row as the machine with its reply.

describe('machine command (workflow + gateway + mock line)', () => {
  let client: InstanceType<typeof Client>;
  let line: Harness;
  let gateway: MachineGateway;
  const users = new Map<string, string>();

  beforeAll(async () => {
    await connectTelemetry();
    await Connection.connect({ class: Postgres, options: postgres_options });
    await migrate();
    for (const [actor, id] of await ensureLineBots(LINE)) users.set(actor, id);

    line = await startHarness({ msPerSec: 2 }, LINE);
    const callbacks = new CallbackEventAdapter();
    eventRegistry.register(callbacks);
    await eventRegistry.connect();
    const feed = new CallbackEscalationFeed(callbacks, 50);

    const connection = { class: Postgres, options: postgres_options };
    const worker = await Worker.create({ connection, taskQueue: TASK_QUEUE, workflow: machineCommand, events: systemEventsConfig });
    await worker.run();
    client = new Client({ connection, events: systemEventsConfig } as any);

    gateway = new MachineGateway({
      bus: new MemoryMachineBus(line.broker, lineFilter(ROOT, LINE.siteId, LINE.lineId)),
      feed, lt: new ApiLineEscalations((as) => users.get(as)!), line: LINE, log: silentLog,
      settings: { topicRoot: ROOT, replyTimeoutMs: 2_000, dispatchAttempts: 2, offlineDebounceMs: 60_000, dispatchTtlMs: 600_000, quietMs: 0 },
    });
    await gateway.start();
  }, 60_000);

  afterAll(async () => {
    await gateway?.stop();
    await line?.stop();
    const { getPool } = await import('../../lib/db');
    await getPool().query(`DELETE FROM lt_escalations WHERE metadata->>'lineId' = $1`, [LINE.lineId]);
    for (const id of users.values()) await userService.deleteUser(id);
    eventRegistry.clear();
    await sleepFor(500);
    await Durable.shutdown();
    await disconnectTelemetry();
  }, 20_000);

  async function run(op: string, args: Record<string, unknown> = {}) {
    const requestKey = `C${Durable.guid().slice(0, 8)}`;
    const handle = await client.workflow.start({
      args: [{ data: { ...commandTarget(LINE, 'press-01'), requestKey, op, args } }],
      taskQueue: TASK_QUEUE, workflowName: 'machineCommand', workflowId: `mc-${requestKey}`, expire: 300,
    });
    const result = await handle.result() as { data: Record<string, any> };
    return { requestKey, data: result.data };
  }

  it('pause then resume: the step returns the machine\'s reply, and the row names the machine', async () => {
    const paused = await run('pause');
    expect(paused.data).toMatchObject({ accepted: true, machineId: 'press-01', op: 'pause', status: 'accepted' });
    expect(line.line.machine('press-01').enabled).toBe(false);
    const row = await escalationService.getEscalationBySignalKey(commandSignalKey(paused.requestKey));
    expect(row).toMatchObject({ type: 'machine-command', subtype: 'pause', role: 'line-bond', status: 'resolved' });
    expect((row!.metadata as any).resolved_by).toBe(users.get('press-01'));
    expect((await run('resume')).data).toMatchObject({ accepted: true, op: 'resume' });
    expect(line.line.machine('press-01').enabled).toBe(true);
  }, 60_000);

  it('changeover: a held version is loaded; one the machine does not hold comes back refused', async () => {
    const [id, versions] = Object.entries(line.line.machine('press-01').recipes)[0];
    expect((await run('changeover', { recipe: { id, version: versions[0] } })).data).toMatchObject({ accepted: true });
    await until(() => line.line.machine('press-01').recipeKey() === `${id}@${versions[0]}` && line.line.machine('press-01').mode === MODE.IDLE, 10_000);
    const refused = await run('changeover', { recipe: { id, version: '999' } });
    expect(refused.data).toMatchObject({ accepted: false, status: 'refused' });
    expect(refused.data.reason).toMatch(/not held/);
  }, 60_000);
});
