import { afterEach, describe, expect, it } from 'vitest';
import { MachineGateway } from '../../../services/machines/gateway/gateway';
import { silentLog } from '../../../services/machines/gateway/log';
import { ROW_TYPE } from '../../../services/machines/contracts';
import { identOf, machineById, stationRole } from '../../../lib/machines/line';
import { CHANNEL, LEVEL, alarmTopic, buildEnvelope, lineFilter, machineTopic } from '../../../lib/machines/protocol';
import { MemoryBroker, MemoryEscalationFeed, MemoryMachineBus } from '../../../lib/machines/transport';
import { FakeLongTail } from '../../../services/machines/testing/fake-long-tail';
import { commandRow, commandTarget } from '../../../services/machines/commands';
import { sleep, until } from '../../../services/machines/testing/wait';
import { DEFAULT_LINE } from '../../../examples/workflows/machine-line/line';
import { OP } from '../../../lib/machines/protocol';
import { GATEWAY_SETTINGS, facetsFor } from '../../helpers/machine-line-gateway-harness';
import { ROOT } from '../../helpers/machine-line-fixtures';

/** A line whose press hears every command and answers none. */
function silentLine() {
  const broker = new MemoryBroker();
  const feed = new MemoryEscalationFeed(broker);
  const lt = new FakeLongTail(feed);
  const ident = identOf(DEFAULT_LINE, 'press-01');
  const heard: string[] = [];
  broker.connect('press-hand');
  broker.subscribe('press-hand', machineTopic(ROOT, ident, CHANNEL.CMD), (msg) => { heard.push(JSON.parse(msg.payload.toString()).body.op); });
  broker.publish(machineTopic(ROOT, ident, CHANNEL.SNAPSHOT), JSON.stringify(buildEnvelope(ident, {
    bootId: 'boot-1', software: '1.0', mode: 'idle', enabled: true, recipe: null, jobs: [], alarms: [], cycles: 0,
  })), true);
  const newGateway = () => new MachineGateway({
    bus: new MemoryMachineBus(broker, lineFilter(ROOT, DEFAULT_LINE.siteId, DEFAULT_LINE.lineId)),
    feed, lt, line: DEFAULT_LINE, settings: { ...GATEWAY_SETTINGS, replyTimeoutMs: 300, dispatchAttempts: 1 }, log: silentLog,
  });
  return { lt, heard, broker, ident, gateway: newGateway(), newGateway };
}

/** A critical alarm published on the stream only, so a gateway taking the line can learn of it from nowhere else. */
function raiseAlarm(line: ReturnType<typeof silentLine>, alarmId: string): void {
  line.broker.publish(alarmTopic(ROOT, line.ident, alarmId), JSON.stringify(buildEnvelope(line.ident, {
    alarmId, code: 'F-101', level: LEVEL.CRITICAL, text: 'Platen over temperature', active: true, raisedAt: '2026-01-01T00:00:00.000Z',
    clearedAt: null, clearedBy: null, ackedBy: null, ackedAt: null, zone: null, autoClears: false, action: null, jobId: null,
  })), false);
}

describe('a gateway that stops', () => {
  let gateway: MachineGateway | undefined;
  afterEach(async () => { await gateway?.stop(); gateway = undefined; });

  it('leaves a command row it was still asking about open for the next leader', async () => {
    const line = silentLine();
    gateway = line.gateway;
    await gateway.start();
    const row = line.lt.parkRow(commandRow(commandTarget(DEFAULT_LINE, 'press-01'), OP.PAUSE));
    await until(() => line.heard.includes(OP.PAUSE));
    await gateway.stop();
    gateway = undefined;
    await sleep(500);
    expect(line.lt.rows.get(row.id)?.status).toBe('pending');
  });

  it('leaves a handoff it was still dispatching open, asking the machine nothing more', async () => {
    const line = silentLine();
    gateway = line.gateway;
    await gateway.start();
    const row = line.lt.park(stationRole(machineById(DEFAULT_LINE, 'press-01').process), facetsFor('U1', null, 'press-01'));
    await until(() => line.heard.includes(OP.DISPATCH));
    const sent = line.heard.length;
    await gateway.stop();
    gateway = undefined;
    await sleep(500);
    expect(line.lt.rows.get(row.id)?.status).toBe('pending');
    expect(line.heard).toHaveLength(sent);
  });

  it('an alarm that arrives while it drains makes no row; the next gateway on the same stream raises it', async () => {
    const line = silentLine();
    gateway = line.gateway;
    await gateway.start();
    await sleep(20);
    const stopping = gateway.stop();
    raiseAlarm(line, 'A-1');
    await stopping;
    gateway = undefined;
    await sleep(50);
    expect(line.lt.ofType(ROW_TYPE.ALARM)).toEqual([]);

    gateway = line.newGateway();
    await gateway.start();
    const row = await until(() => line.lt.ofType(ROW_TYPE.ALARM)[0]);
    expect(row.metadata).toMatchObject({ machineId: 'press-01', alarmId: 'A-1' });
    await gateway.idle();
    await sleep(30);
    expect(line.lt.ofType(ROW_TYPE.ALARM)).toHaveLength(1);
  });
});
