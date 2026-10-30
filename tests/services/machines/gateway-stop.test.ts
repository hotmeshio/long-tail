import { afterEach, describe, expect, it } from 'vitest';
import { MachineGateway } from '../../../services/machines/gateway/gateway';
import { silentLog } from '../../../services/machines/gateway/log';
import { identOf, machineById, stationRole } from '../../../lib/machines/line';
import { CHANNEL, buildEnvelope, lineFilter, machineTopic } from '../../../lib/machines/protocol';
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
  const gateway = new MachineGateway({
    bus: new MemoryMachineBus(broker, lineFilter(ROOT, DEFAULT_LINE.siteId, DEFAULT_LINE.lineId)),
    feed, lt, line: DEFAULT_LINE, settings: { ...GATEWAY_SETTINGS, replyTimeoutMs: 300, dispatchAttempts: 1 }, log: silentLog,
  });
  return { lt, heard, gateway };
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
});
