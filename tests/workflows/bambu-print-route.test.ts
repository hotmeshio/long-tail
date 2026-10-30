import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client as Postgres } from 'pg';
import { Durable } from '@hotmeshio/hotmesh';

import { postgres_options, sleepFor } from '../setup';
import { connectTelemetry, disconnectTelemetry } from '../setup/telemetry';
import { migrate } from '../../lib/db/migrate';
import * as escalationApi from '../../api/escalations';
import * as escalationService from '../../services/escalation';
import * as userService from '../../services/user';
import { eventRegistry } from '../../lib/events';
import { systemEventsConfig } from '../../lib/events/system-events';
import { CallbackEventAdapter } from '../../lib/events/callback';
import { machineUnitRoute } from '../../examples/workflows/machine-line';
import { bambuCodec } from '../../examples/workflows/bambu-printer/codec';
import { BAMBU_ROLES, PRINT_PROCESS, PRINT_RECIPE, bambuLine } from '../../examples/workflows/bambu-printer/env';
import { DECISION, HANDOFF_ERROR, LINE_ROLE, ROW_TYPE, signalKeys } from '../../services/machines/contracts';
import { MachineGateway } from '../../services/machines/gateway/gateway';
import { ApiLineEscalations } from '../../services/machines/gateway/api-escalations';
import { silentLog } from '../../services/machines/gateway/log';
import { ensureLineBots } from '../../services/machines/identities';
import { lineFilter } from '../../lib/machines/protocol';
import { CallbackEscalationFeed, MemoryBroker, MemoryMachineBus } from '../../lib/machines/transport';
import { SimPrinter } from '../helpers/bambu-printer-sim';
import { SERIAL, STATION } from '../fixtures/bambu/reports';
import type { LTEscalationRecord } from '../../types';

const { Connection, Client, Worker } = Durable;
const TASK_QUEUE = 'test-bambu-print-route';
const ROOT = 'line/v1';
// A line of its own per run, so rows left by another run belong to another line.
const LINE = bambuLine([{ station: STATION, serial: SERIAL, host: 'sim', code: 'sim', enabled: true }], { BAMBU_SITE_ID: 'site-1', BAMBU_LINE_ID: `print-${Date.now().toString(36)}` });
const STEP = { machineId: STATION, process: PRINT_PROCESS, recipe: { ...PRINT_RECIPE } };
const ARTIFACT = { url: 'http://files.local/part.gcode.3mf', sha256: 'a'.repeat(64) };

// One print through the real orchestrator: the route parks the same rows it
// would for people; the gateway, speaking to a simulated Bambu printer through
// the Bambu codec, claims the print row as the printer, notes its lifecycle,
// and resolves it at the finish; a person unloads the part.

describe('a Bambu print through the unit route (workflow + gateway + simulated printer)', () => {
  let client: InstanceType<typeof Client>;
  let gateway: MachineGateway;
  let printer: SimPrinter;
  let lt: ApiLineEscalations;
  const users = new Map<string, string>();
  let personId: string;

  async function rowBySignal(signalKey: string, ms = 20_000): Promise<LTEscalationRecord> {
    const deadline = Date.now() + ms;
    for (;;) {
      const row = await escalationService.getEscalationBySignalKey(signalKey);
      if (row) return row;
      if (Date.now() > deadline) throw new Error(`no row for ${signalKey}`);
      await sleepFor(100);
    }
  }

  async function eventually<T>(check: () => Promise<T | undefined | null | false>, ms = 15_000): Promise<T> {
    const end = Date.now() + ms;
    for (;;) {
      const value = await check();
      if (value) return value;
      if (Date.now() > end) throw new Error('condition not met in time');
      await sleepFor(100);
    }
  }

  const itemKeysOf = async (id: string) => (await lt.items(id)).map((i) => i.itemKey);
  const row = async (id: string) => (await escalationService.getEscalation(id))!;
  const unload = (id: string) => escalationApi.resolveEscalation({ id, resolverPayload: { received: true, receiver: 'person' } }, { userId: personId });

  beforeAll(async () => {
    await connectTelemetry();
    await Connection.connect({ class: Postgres, options: postgres_options });
    await migrate();

    for (const [actor, id] of await ensureLineBots(LINE)) users.set(actor, id);
    const person = await userService.createUser({
      external_id: `print-person-${Date.now()}`,
      roles: [BAMBU_ROLES.UNLOAD, BAMBU_ROLES.SERVICING, LINE_ROLE.OPERATOR].map((role) => ({ role, type: 'member' as const })),
    });
    personId = person.id;

    const broker = new MemoryBroker({ redeliverMs: 200 });
    printer = new SimPrinter(broker, { prefix: `${ROOT}/${LINE.siteId}/${LINE.lineId}/${SERIAL}`, steps: 8, tickMs: 60 });
    printer.connect();
    const callbacks = new CallbackEventAdapter();
    eventRegistry.register(callbacks);
    await eventRegistry.connect();

    const connection = { class: Postgres, options: postgres_options };
    const worker = await Worker.create({ connection, taskQueue: TASK_QUEUE, workflow: machineUnitRoute, events: systemEventsConfig });
    await worker.run();
    client = new Client({ connection, events: systemEventsConfig } as any);

    lt = new ApiLineEscalations((as) => users.get(as)!);
    gateway = new MachineGateway({
      bus: new MemoryMachineBus(broker, lineFilter(ROOT, LINE.siteId, LINE.lineId)),
      feed: new CallbackEscalationFeed(callbacks, 50), lt, line: LINE, codec: bambuCodec({ root: ROOT, line: LINE }), log: silentLog,
      settings: { topicRoot: ROOT, replyTimeoutMs: 2_000, dispatchAttempts: 2, offlineDebounceMs: 60_000, dispatchTtlMs: 600_000, quietMs: 0, lifecycle: true, progressStep: 25 },
    });
    await gateway.start();
  }, 60_000);

  afterAll(async () => {
    printer?.stop();
    await gateway?.stop();
    const { getPool } = await import('../../lib/db');
    await getPool().query(`DELETE FROM lt_escalations WHERE metadata->>'lineId' = $1`, [LINE.lineId]);
    for (const id of [...users.values(), personId]) if (id) await userService.deleteUser(id);
    eventRegistry.clear();
    await sleepFor(500);
    await Durable.shutdown();
    await disconnectTelemetry();
  }, 20_000);

  function start(routeKey: string) {
    return client.workflow.start({
      args: [{ data: {
        siteId: LINE.siteId, lineId: LINE.lineId, routeKey, orderRef: `ORD-${routeKey}`, units: [{ unitId: `U-${routeKey}`, carrierId: `CR-${routeKey}` }],
        steps: [STEP], artifact: ARTIFACT, exitRole: BAMBU_ROLES.UNLOAD,
      } }],
      taskQueue: TASK_QUEUE, workflowName: 'machineUnitRoute', workflowId: `bpr-${routeKey}`, expire: 300,
    });
  }

  it('prints: the print row holds the lifecycle and resolves at the finish; a person unloads the part', async () => {
    const routeKey = `P${Durable.guid().slice(0, 8)}`;
    const handle = await start(routeKey);
    const print = await rowBySignal(signalKeys.handoff(routeKey, 0, 1));
    const done = await eventually(async () => ((await row(print.id)).status === 'resolved' ? row(print.id) : null));
    expect(done.assigned_to).toBe(users.get(STATION));
    const payload = typeof done.resolver_payload === 'string' ? JSON.parse(done.resolver_payload) : done.resolver_payload;
    expect(payload).toMatchObject({ received: true, receiver: STATION });
    const keys = await itemKeysOf(print.id);
    const unit = `U-${routeKey}`;
    expect(keys).toEqual([`started:${unit}`, `progress:${unit}:25`, `progress:${unit}:50`, `progress:${unit}:75`, `arrived:${unit}`]);
    expect((done.metadata as any).progress).toMatchObject({ percent: expect.any(Number) });

    const out = await rowBySignal(signalKeys.handoff(routeKey, 1, 1));
    await eventually(async () => (await itemKeysOf(out.id)).includes(`released:${unit}`));
    expect((await unload(out.id)).status).toBe(200);
    expect((await handle.result() as any).data).toMatchObject({ status: 'complete' });
    expect(printer.requests.filter((r) => r.print?.command === 'project_file')[0].print).toMatchObject({ url: ARTIFACT.url, subtask_name: `${routeKey}-${STATION}~${unit}` });
  }, 60_000);

  it('a runout pauses the print: a servicing row comes and goes, and the print row notes the pause and the resume', async () => {
    const routeKey = `R${Durable.guid().slice(0, 8)}`;
    printer.hold(50);
    const handle = await start(routeKey);
    const print = await rowBySignal(signalKeys.handoff(routeKey, 0, 1));
    const unit = `U-${routeKey}`;
    await eventually(async () => (await itemKeysOf(print.id)).includes(`progress:${unit}:50`));
    printer.runOut();
    const alarm = await eventually(async () => {
      const { escalations } = await escalationService.listEscalations({ role: BAMBU_ROLES.SERVICING, type: ROW_TYPE.ALARM, status: 'pending', metadata: { lineId: LINE.lineId } });
      return escalations[0];
    });
    expect((alarm.metadata as any)).toMatchObject({ machineId: STATION, code: '07FF-8011' });
    await eventually(async () => (await itemKeysOf(print.id)).some((k) => k.startsWith('paused:print-error:')));

    printer.resumeAtPrinter();
    printer.release();
    await eventually(async () => (await row(alarm.id)).status === 'resolved');
    await eventually(async () => (await row(print.id)).status === 'resolved');
    const keys = await itemKeysOf(print.id);
    expect(keys.filter((k) => /^(paused|resumed):/.test(k))).toHaveLength(2);
    expect(keys.length).toBeLessThanOrEqual(7);

    await unload((await rowBySignal(signalKeys.handoff(routeKey, 1, 1))).id);
    expect((await handle.result() as any).data).toMatchObject({ status: 'complete' });
  }, 60_000);

  it('holds the printer until the part is unloaded: a second print waits, then goes', async () => {
    const first = `A${Durable.guid().slice(0, 8)}`;
    const second = `B${Durable.guid().slice(0, 8)}`;
    const handleA = await start(first);
    const outA = await rowBySignal(signalKeys.handoff(first, 1, 1));
    const handleB = await start(second);
    const printB = await rowBySignal(signalKeys.handoff(second, 0, 1));
    await sleepFor(1_000);
    expect((await row(printB.id)).assigned_to).toBeFalsy();

    await eventually(async () => (await itemKeysOf(outA.id)).length > 0);
    await unload(outA.id);
    expect((await handleA.result() as any).data).toMatchObject({ status: 'complete' });
    await eventually(async () => (await row(printB.id)).status === 'resolved');
    await unload((await rowBySignal(signalKeys.handoff(second, 1, 1))).id);
    expect((await handleB.result() as any).data).toMatchObject({ status: 'complete' });
  }, 60_000);

  it('a print the printer refuses goes to a person to decide', async () => {
    const routeKey = `F${Durable.guid().slice(0, 8)}`;
    printer.occupy();
    const handle = await start(routeKey);
    const decide = await rowBySignal(signalKeys.handoffError(routeKey, 0, 1));
    expect((decide.metadata as any).errorCode).toBe(HANDOFF_ERROR.DISPATCH_REFUSED);
    await escalationApi.resolveEscalation({ id: decide.id, resolverPayload: { decision: DECISION.SCRAP } }, { userId: personId });
    expect((await handle.result() as any).data).toMatchObject({ status: 'scrapped' });
    printer.vacate();
  }, 60_000);
});
