/**
 * The unit workflow on the real orchestrator, a gateway speaking the
 * directional test codec over the memory broker, and the mock line behind a
 * relay. Long Tail is real: rows live in Postgres and every verb runs through
 * the escalation API as the machine's bot user.
 */

import { Client as Postgres } from 'pg';
import { Durable } from '@hotmeshio/hotmesh';

import { postgres_options, sleepFor } from '../setup';
import { connectTelemetry, disconnectTelemetry } from '../setup/telemetry';
import { migrate } from '../../lib/db/migrate';
import * as escalationService from '../../services/escalation';
import * as userService from '../../services/user';
import { eventRegistry } from '../../lib/events';
import { systemEventsConfig } from '../../lib/events/system-events';
import { CallbackEventAdapter } from '../../lib/events/callback';
import { machineUnitRoute } from '../../examples/workflows/machine-line';
import { DEFAULT_LINE } from '../../examples/workflows/machine-line/line';
import { MachineGateway } from '../../services/machines/gateway/gateway';
import { silentLog } from '../../services/machines/gateway/log';
import { ApiLineEscalations } from '../../services/machines/gateway/api-escalations';
import { BotAddressBook, ensureLineBots } from '../../services/machines/identities';
import { DISPATCH_ON, lineFilter, type DispatchOn } from '../../lib/machines/protocol';
import { CallbackEscalationFeed, MemoryMachineBus } from '../../lib/machines/transport';
import type { LineDef } from '../../lib/machines/line';
import type { MockSettings } from '../../examples/workflows/machine-line/mock';
import type { LTEscalationRecord } from '../../types';
import { startHarness, REAL_ORCHESTRATOR_BROKER, type Harness } from './machine-line-fixtures';
import { WIRE_ROOT, addressedLine, directionalCodec, relayMockLine, watchReceipts } from './machine-line-directional';

const { Connection, Client, Worker } = Durable;

/** Resolve with the first truthy value an async `check` gives, or throw after `ms`. */
export async function eventually<T>(check: () => Promise<T | undefined | null | false>, ms = 10_000): Promise<T> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const value = await check();
    if (value) return value;
    await sleepFor(50);
  }
  throw new Error('condition not met in time');
}

export interface WorkflowRig {
  /** The line as the gateway knows it. */
  line: LineDef;
  /** The line as the machines know it: every machine with its own address. */
  machines: LineDef;
  harness: Harness;
  gateway: MachineGateway;
  users: Map<string, string>;
  personId: string;
  receipts: { topic: string; ids: string[] }[];
  start(routeKey: string, units: string[], extra?: Record<string, unknown>): ReturnType<InstanceType<typeof Client>['workflow']['start']>;
  rowBySignal(signalKey: string, ms?: number): Promise<LTEscalationRecord>;
  startGateway(): Promise<MachineGateway>;
  stop(): Promise<void>;
}

/** `learned`: the gateway's line names stations only and learns each machine's address from its messages. */
export async function startWorkflowRig(opts: { taskQueue: string; dispatchOn?: DispatchOn; mock?: Partial<MockSettings>; learned?: boolean }): Promise<WorkflowRig> {
  await connectTelemetry();
  await Connection.connect({ class: Postgres, options: postgres_options });
  await migrate();

  // A line of its own per run, so rows left by another run belong to another line.
  const machines = addressedLine({ ...structuredClone(DEFAULT_LINE), lineId: `line-${Date.now().toString(36)}` });
  const line: LineDef = opts.learned
    ? { ...machines, addressing: 'learned', machines: machines.machines.map(({ address: _address, ...m }) => m) }
    : machines;
  const users = new Map<string, string>();
  for (const [actor, id] of await ensureLineBots(line)) users.set(actor, id);
  const person = await userService.createUser({
    external_id: `line-person-${Date.now()}`,
    roles: [{ role: 'line-exit', type: 'member' }, { role: 'line-operator', type: 'member' }],
  });

  const harness = await startHarness({ msPerSec: 2, ...opts.mock }, machines, REAL_ORCHESTRATOR_BROKER);
  relayMockLine(harness.broker, machines);
  const receipts = watchReceipts(harness.broker, machines);
  const callbacks = new CallbackEventAdapter();
  eventRegistry.register(callbacks);
  await eventRegistry.connect();

  const connection = { class: Postgres, options: postgres_options };
  const worker = await Worker.create({ connection, taskQueue: opts.taskQueue, workflow: machineUnitRoute, events: systemEventsConfig });
  await worker.run();
  const client = new Client({ connection, events: systemEventsConfig } as any);

  const codec = directionalCodec(line, opts.dispatchOn ?? DISPATCH_ON.CREATED);
  const startGateway = async () => {
    const gw = new MachineGateway({
      bus: new MemoryMachineBus(harness.broker, lineFilter(WIRE_ROOT, line.siteId, line.lineId)),
      feed: new CallbackEscalationFeed(callbacks, 50), lt: new ApiLineEscalations((as) => users.get(as)!), line, codec, log: silentLog,
      ...(opts.learned ? { addresses: new BotAddressBook(users) } : {}),
      settings: { topicRoot: WIRE_ROOT, replyTimeoutMs: 1_000, dispatchAttempts: 2, offlineDebounceMs: 60_000, dispatchTtlMs: 600_000, quietMs: 0, receiptDelayMs: 20 },
    });
    await gw.start();
    return gw;
  };

  const rig: WorkflowRig = {
    line, machines, harness, users, personId: person.id, receipts, gateway: await startGateway(), startGateway,
    start: (routeKey, units, extra = {}) => client.workflow.start({
      args: [{ data: { siteId: line.siteId, lineId: line.lineId, routeKey, orderRef: `ORD-${routeKey}`, units: units.map((unitId) => ({ unitId, carrierId: `CR-${unitId}` })), ...extra } }],
      taskQueue: opts.taskQueue, workflowName: 'machineUnitRoute', workflowId: `mur-${routeKey}`, expire: 300,
    }),
    async rowBySignal(signalKey, ms = 20_000) {
      const deadline = Date.now() + ms;
      for (;;) {
        const row = await escalationService.getEscalationBySignalKey(signalKey);
        if (row) return row;
        if (Date.now() > deadline) throw new Error(`no row for ${signalKey}`);
        await sleepFor(100);
      }
    },
    async stop() {
      await rig.gateway?.stop();
      await harness.stop();
      const { getPool } = await import('../../lib/db');
      await getPool().query(`DELETE FROM lt_escalations WHERE metadata->>'lineId' = $1`, [line.lineId]);
      for (const id of [...users.values(), person.id]) await userService.deleteUser(id);
      eventRegistry.clear();
      await sleepFor(500);
      await Durable.shutdown();
      await disconnectTelemetry();
    },
  };
  return rig;
}
