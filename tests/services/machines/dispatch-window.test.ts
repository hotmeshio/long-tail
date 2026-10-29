import { afterEach, describe, expect, it } from 'vitest';
import { MachineGateway } from '../../../services/machines/gateway/gateway';
import { silentLog } from '../../../services/machines/gateway/log';
import { dispatchWindow } from '../../../services/machines/gateway/pacing';
import { identOf, machineById, stationRole } from '../../../lib/machines/line';
import { CHANNEL, OP, REPLY_STATUS, buildEnvelope, lineFilter, machineTopic } from '../../../lib/machines/protocol';
import { MemoryBroker, MemoryEscalationFeed, MemoryMachineBus } from '../../../lib/machines/transport';
import { FakeLongTail } from '../../../services/machines/testing/fake-long-tail';
import { until } from '../../../services/machines/testing/wait';
import { DEFAULT_LINE } from '../../../examples/workflows/machine-line/line';
import { GATEWAY_SETTINGS, facetsFor } from '../../helpers/machine-line-gateway-harness';
import { ROOT } from '../../helpers/machine-line-fixtures';

const TTL = 60_000;

describe('dispatch windows', () => {
  it('counts rounds of the validity period from the row\'s creation, moving to the next round past its middle', () => {
    expect(dispatchWindow(0, 0, TTL)).toEqual({ round: 1, expiresAt: TTL });
    expect(dispatchWindow(0, 29_000, TTL)).toEqual({ round: 1, expiresAt: TTL });
    expect(dispatchWindow(0, 31_000, TTL)).toEqual({ round: 2, expiresAt: 2 * TTL });
    expect(dispatchWindow(0, 95_000, TTL)).toEqual({ round: 3, expiresAt: 3 * TTL });
    for (const now of [0, 29_000, 31_000, 95_000, 200_000]) {
      const { expiresAt } = dispatchWindow(0, now, TTL);
      expect(expiresAt - now).toBeGreaterThanOrEqual(TTL / 2);
    }
  });
});

describe('a dispatch sent again', () => {
  let gateway: MachineGateway | undefined;
  afterEach(async () => { await gateway?.stop(); });

  it('after the machine restarts and loses it, is the same command with the same arguments', async () => {
    const broker = new MemoryBroker();
    const feed = new MemoryEscalationFeed(broker);
    const lt = new FakeLongTail(feed);
    const ident = identOf(DEFAULT_LINE, 'press-01');
    const dispatches: { cmdId: string; args: Record<string, unknown> }[] = [];
    broker.connect('press-hand');
    broker.subscribe('press-hand', machineTopic(ROOT, ident, CHANNEL.CMD), (msg) => {
      const cmd = JSON.parse(msg.payload.toString()).body;
      if (cmd.op === OP.DISPATCH) dispatches.push({ cmdId: cmd.cmdId, args: cmd.args });
      broker.publish(machineTopic(ROOT, ident, CHANNEL.REPLY), JSON.stringify(buildEnvelope(ident, { cmdId: cmd.cmdId, status: REPLY_STATUS.ACCEPTED, reason: '' })));
    });
    const snapshot = (bootId: string) => broker.publish(machineTopic(ROOT, ident, CHANNEL.SNAPSHOT), JSON.stringify(buildEnvelope(ident, {
      bootId, software: '1.0', mode: 'idle', enabled: true, recipe: null, jobs: [], alarms: [], cycles: 0,
    })), true);
    snapshot('boot-1');
    gateway = new MachineGateway({
      bus: new MemoryMachineBus(broker, lineFilter(ROOT, DEFAULT_LINE.siteId, DEFAULT_LINE.lineId)),
      feed, lt, line: DEFAULT_LINE, settings: { ...GATEWAY_SETTINGS, dispatchTtlMs: TTL }, log: silentLog,
    });
    await gateway.start();

    const row = lt.park(stationRole(machineById(DEFAULT_LINE, 'press-01').process), facetsFor('U1', null, 'press-01'));
    await until(() => lt.rows.get(row.id)?.assigned_to === 'press-01');
    snapshot('boot-2');
    await until(() => dispatches.length === 2);

    expect(dispatches[1].cmdId).toBe(`${row.id}:dispatch`);
    expect(dispatches[1]).toEqual(dispatches[0]);
  });
});
