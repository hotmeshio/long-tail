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
import { machineUnitRoute } from '../../examples/workflows/machine-line';
import { signalKeys } from '../../services/machines/contracts';
import { lineSteps } from '../../examples/workflows/machine-line/workflows/route';
import { CONTROLLER } from '../../services/machines/gateway/actions';
import { MachineGateway } from '../../services/machines/gateway/gateway';
import { silentLog } from '../../services/machines/gateway/log';
import { ensureLineBots } from '../../services/machines/identities';
import { CallbackEventAdapter } from '../../lib/events/callback';
import { DEFAULT_LINE } from '../../examples/workflows/machine-line/line';
import { lineFilter } from '../../lib/machines/protocol';
import { CallbackEscalationFeed, MemoryMachineBus } from '../../lib/machines/transport';
import { ApiLineEscalations } from '../../services/machines/gateway/api-escalations';
import { ROOT, startHarness, type Harness } from '../helpers/machine-line-fixtures';
import type { LTEscalationRecord } from '../../types';

const { Connection, Client, Worker } = Durable;
const TASK_QUEUE = 'test-machine-unit-route';
// A line of its own per run, so rows left by another run belong to another line.
const LINE = { ...structuredClone(DEFAULT_LINE), lineId: `line-${Date.now().toString(36)}` };
const STEPS = lineSteps(DEFAULT_LINE);

// The whole surface through the real orchestrator: the durable unit workflow
// parks handoff rows; the gateway dispatches, claims and resolves them as each
// machine over the mock line; a person receives at line exit and decides a
// failed handoff on the operator row.

describe('machine unit route (workflow + gateway + mock line)', () => {
  let client: InstanceType<typeof Client>;
  let line: Harness;
  let gateway: MachineGateway;
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

  async function receiveAtExit(routeKey: string, step: number, units: string[]): Promise<void> {
    const exit = await rowBySignal(signalKeys.handoff(routeKey, step, 1));
    for (const unitId of units) {
      for (let i = 0; i < 100 && !(await line.line.unload('inspect-01', { unitId })); i++) await sleepFor(50);
    }
    const result = await escalationApi.resolveEscalation({ id: exit.id, resolverPayload: { received: true, receiver: 'person' } }, { userId: personId });
    expect(result.status).toBe(200);
  }

  beforeAll(async () => {
    await connectTelemetry();
    await Connection.connect({ class: Postgres, options: postgres_options });
    await migrate();

    const stamp = Date.now();
    for (const [actor, id] of await ensureLineBots(LINE)) users.set(actor, id);
    const person = await userService.createUser({ external_id: `line-person-${stamp}`, roles: [{ role: 'line-exit', type: 'member' }, { role: 'line-operator', type: 'member' }, { role: 'line-finisher', type: 'member' }] });
    personId = person.id;

    line = await startHarness({ msPerSec: 2 }, LINE);
    const callbacks = new CallbackEventAdapter();
    eventRegistry.register(callbacks);
    await eventRegistry.connect();
    const feed = new CallbackEscalationFeed(callbacks, 50);

    // Workers first, as start() does: the engine they create carries the
    // system events hook that publishes each handoff row's created event.
    const connection = { class: Postgres, options: postgres_options };
    const worker = await Worker.create({ connection, taskQueue: TASK_QUEUE, workflow: machineUnitRoute, events: systemEventsConfig });
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
    for (const id of [...users.values(), personId]) if (id) await userService.deleteUser(id);
    eventRegistry.clear();
    await sleepFor(500);
    await Durable.shutdown();
    await disconnectTelemetry();
  }, 20_000);

  async function start(routeKey: string, units: string[], extra: Record<string, unknown> = {}) {
    return client.workflow.start({
      args: [{ data: { siteId: LINE.siteId, lineId: LINE.lineId, routeKey, orderRef: `ORD-${routeKey}`, units: units.map((unitId) => ({ unitId, carrierId: `CR-${unitId}` })), steps: STEPS, ...extra } }],
      taskQueue: TASK_QUEUE,
      workflowName: 'machineUnitRoute',
      workflowId: `mur-${routeKey}`,
      expire: 300,
    });
  }

  it('two units ride the line; each machine resolves its own handoff; a person receives them at exit', async () => {
    const routeKey = `R${Durable.guid().slice(0, 8)}`;
    const handle = await start(routeKey, ['A1', 'A2']);
    await receiveAtExit(routeKey, 3, ['A1', 'A2']);
    const final = await handle.result() as { data: { status: string; history: any[] } };
    expect(final.data.status).toBe('complete');
    expect(final.data.history.map((h) => [h.to, h.received])).toEqual([['press-01', true], ['cut-01', true], ['inspect-01', true], ['exit', true]]);

    const intoCut = await rowBySignal(signalKeys.handoff(routeKey, 1, 1));
    expect(intoCut.assigned_to).toBe(users.get('cut-01'));
    expect((intoCut.metadata as any).resolved_by).toBe(users.get('cut-01'));
    const items = await escalationApi.getEscalationItems({ id: intoCut.id }, { userId: users.get(CONTROLLER)! });
    expect((items.data as any).items.map((i: any) => i.itemKey).sort()).toEqual(['arrived:A1', 'arrived:A2', 'released:A1', 'released:A2']);
  }, 90_000);

  it('a jam asks the operator; retry after clearing completes the route', async () => {
    const routeKey = `R${Durable.guid().slice(0, 8)}`;
    line.line.armTransfer('press-01', { fault: 'jam' });
    const handle = await start(routeKey, ['B1']);
    const decide = await rowBySignal(signalKeys.handoffError(routeKey, 1, 1));
    expect(decide).toMatchObject({ role: 'line-operator', type: 'handoff-error', subtype: 'jam' });
    const alarm = line.line.machine('press-01').alarms.list()[0];
    await line.line.clearAlarm('press-01', { alarmId: alarm.alarmId, by: 'tech-1' });
    expect((await escalationApi.resolveEscalation({ id: decide.id, resolverPayload: { decision: 'retry', note: 'cleared' } }, { userId: personId })).status).toBe(200);
    await receiveAtExit(routeKey, 3, ['B1']);
    const final = await handle.result() as { data: { status: string; history: any[] } };
    expect(final.data.status).toBe('complete');
    expect(final.data.history.filter((h) => h.to === 'cut-01').map((h) => [h.attempt, h.received, h.errorCode])).toEqual([[1, false, 'jam'], [2, true, undefined]]);
  }, 90_000);

  it('manual after a jam: a person takes the units from where they stopped', async () => {
    const routeKey = `R${Durable.guid().slice(0, 8)}`;
    line.line.armTransfer('press-01', { fault: 'jam' });
    const handle = await start(routeKey, ['M1']);
    const decide = await rowBySignal(signalKeys.handoffError(routeKey, 1, 1));
    const alarm = line.line.machine('press-01').alarms.list()[0];
    await line.line.clearAlarm('press-01', { alarmId: alarm.alarmId, by: 'tech-1' });
    expect((await escalationApi.resolveEscalation({ id: decide.id, resolverPayload: { decision: 'manual', note: 'hand carry' } }, { userId: personId })).status).toBe(200);
    const exit = await rowBySignal(signalKeys.handoff(routeKey, STEPS.length + 1, 1));
    expect(exit).toMatchObject({ role: 'line-exit' });
    expect((exit.metadata as any).fromMachine).toBe('press-01');
    await line.line.unload('press-01', { unitId: 'M1' });
    expect((await escalationApi.resolveEscalation({ id: exit.id, resolverPayload: { received: true, receiver: 'person' } }, { userId: personId })).status).toBe(200);
    const final = await handle.result() as { data: Record<string, any> };
    expect(final.data).toMatchObject({ status: 'manual', at: 'press-01', received: true });
  }, 90_000);

  it('scrap after a reject ends the route', async () => {
    const routeKey = `R${Durable.guid().slice(0, 8)}`;
    line.line.arm('press-01', { result: 'reject', reason: 'BOND-WEAK' });
    const handle = await start(routeKey, ['S1']);
    const decide = await rowBySignal(signalKeys.handoffError(routeKey, 1, 1));
    expect(decide).toMatchObject({ subtype: 'sender-rejected' });
    await line.line.unload('press-01', { unitId: 'S1' });
    expect((await escalationApi.resolveEscalation({ id: decide.id, resolverPayload: { decision: 'scrap', note: 'weak bond' } }, { userId: personId })).status).toBe(200);
    const final = await handle.result() as { data: Record<string, any> };
    expect(final.data).toMatchObject({ status: 'scrapped', at: 'press-01', note: 'weak bond' });
  }, 90_000);

  it('no operator decision before the timeout scraps the units', async () => {
    const routeKey = `R${Durable.guid().slice(0, 8)}`;
    line.line.arm('press-01', { result: 'reject', reason: 'BOND-WEAK' });
    const handle = await start(routeKey, ['T1'], { operatorTimeout: '3s' });
    await rowBySignal(signalKeys.handoffError(routeKey, 1, 1));
    await line.line.unload('press-01', { unitId: 'T1' });
    const final = await handle.result() as { data: Record<string, any> };
    expect(final.data).toMatchObject({ status: 'scrapped', note: 'no decision before the timeout' });
  }, 90_000);

  it('a route mixing a machine and a person: the workflow waits on both rows the same way', async () => {
    const routeKey = `R${Durable.guid().slice(0, 8)}`;
    const steps = [STEPS[0], { role: 'line-finisher' }];
    const handle = await start(routeKey, ['P1'], { steps, exitRole: 'line-exit' });
    const intoFinisher = await rowBySignal(signalKeys.handoff(routeKey, 1, 1));
    expect(intoFinisher).toMatchObject({ role: 'line-finisher', type: 'handoff' });
    expect((intoFinisher.metadata as any)).toMatchObject({ fromMachine: 'press-01', toMachine: null });
    for (let i = 0; i < 100 && !(await line.line.unload('press-01', { unitId: 'P1' })); i++) await sleep(50);
    expect((await escalationApi.resolveEscalation({ id: intoFinisher.id, resolverPayload: { received: true, receiver: 'finisher' } }, { userId: personId })).status).toBe(200);
    const exit = await rowBySignal(signalKeys.handoff(routeKey, 2, 1));
    expect((await escalationApi.resolveEscalation({ id: exit.id, resolverPayload: { received: true, receiver: 'person' } }, { userId: personId })).status).toBe(200);
    const final = await handle.result() as { data: Record<string, any> };
    expect(final.data.status).toBe('complete');
    expect(final.data.history.map((h: any) => [h.to, h.received])).toEqual([['press-01', true], ['line-finisher', true], ['exit', true]]);
  }, 90_000);
});
