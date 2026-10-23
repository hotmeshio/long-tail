import { describe, it, expect, afterEach } from 'vitest';

import { DECISION, ROW_TYPE } from '../../../services/machines/contracts';
import { GATEWAY_LOG } from '../../../services/machines/gateway/log';
import { MemoryAddressBook } from '../../../services/machines/gateway/address-book';
import { RecordingLog } from '../../../services/machines/testing/recording-log';
import { CHANNEL, OP, buildEnvelope, machineTopic, type MachineIdent } from '../../../lib/machines/protocol';
import { startRig, type LineRig } from '../../helpers/machine-line-gateway-harness';
import { ROOT, sleep, until } from '../../helpers/machine-line-fixtures';
import { DEFAULT_LINE } from '../../../examples/workflows/machine-line/line';

let rig: LineRig;
afterEach(async () => rig?.stop());

// The machines know their own permanent addresses; the gateway's line names stations only.
const uuidOf = (machineId: string) => `${machineId}-0000-4000-8000-000000000000`.replace(/^([a-z]+)-(\d+)/, (_, p, n) => `${p.padEnd(8, '0').slice(0, 8)}-${n.padStart(4, '0')}`);
const MACHINES = { ...DEFAULT_LINE, machines: DEFAULT_LINE.machines.map((m) => ({ ...m, address: uuidOf(m.machineId) })) };
const LEARNED = { ...DEFAULT_LINE, addressing: 'learned' as const };
const STRANGER = '9e9e9e9e-0000-4000-8000-000000000009';

async function learnedRig(book = new MemoryAddressBook(), log = new RecordingLog()) {
  rig = await startRig({}, {}, MACHINES, { gatewayLine: LEARNED, addresses: book, log });
  return { book, log };
}

/** A presence message from `address`, claiming `station` when given. */
function announce(address: string, station?: string): void {
  const ident: MachineIdent = { siteId: DEFAULT_LINE.siteId, lineId: DEFAULT_LINE.lineId, machineId: station ?? address, address };
  rig.broker.publish(machineTopic(ROOT, ident, CHANNEL.PRESENCE), JSON.stringify(buildEnvelope(ident, { online: true, software: '1.0.0' })));
}

const registrations = () => [...rig.lt.rows.values()].filter((r) => r.type === ROW_TYPE.MACHINE_REGISTRATION);

describe('a line that learns its addresses', () => {
  it('binds each station to the machine that claims it, keeps the binding, and sends work to that address', async () => {
    const { book, log } = await learnedRig();
    const ended = await rig.handoff('U1', null, 'press-01');
    expect(ended.resolver_payload).toMatchObject({ received: true, receiver: 'press-01' });
    expect(rig.recorder.commands(uuidOf('press-01'), OP.DISPATCH)).toHaveLength(1);
    expect((await book.load()).get('press-01')).toBe(uuidOf('press-01'));
    expect(log.of(GATEWAY_LOG.ADDRESS_BOUND).map((e) => e.machine).sort()).toEqual(DEFAULT_LINE.machines.map((m) => m.machineId).sort());
  });

  it('another machine claiming a bound station raises one row and is not acted on; approval moves the station to it', async () => {
    const { book } = await learnedRig();
    announce(STRANGER, 'press-01');
    announce(STRANGER, 'press-01');
    const [row] = await until(() => (registrations().length ? registrations() : undefined));
    await sleep(30);
    expect(registrations()).toHaveLength(1);
    expect(row).toMatchObject({ role: 'line-operator' });
    expect(row.metadata).toMatchObject({ machineId: 'press-01', address: STRANGER, boundAddress: uuidOf('press-01') });
    expect((await book.load()).get('press-01')).toBe(uuidOf('press-01'));

    rig.lt.personResolves(row.id, { decision: DECISION.APPROVE });
    await until(() => rig.gateway.state.stationAt(STRANGER) === 'press-01');
    expect((await book.load()).get('press-01')).toBe(STRANGER);
    rig.park('U2', null, 'press-01');
    await until(() => rig.recorder.commands(STRANGER, OP.DISPATCH).length);
    expect(rig.recorder.commands(uuidOf('press-01'), OP.DISPATCH)).toHaveLength(0);
  });

  it('a rejected claim leaves the station where it was', async () => {
    const { book } = await learnedRig();
    announce(STRANGER, 'cut-01');
    const [row] = await until(() => (registrations().length ? registrations() : undefined));
    rig.lt.personResolves(row.id, { decision: DECISION.REJECT });
    await sleep(30);
    expect((await book.load()).get('cut-01')).toBe(uuidOf('cut-01'));
  });

  it('an address that claims no station is ignored, and logged once', async () => {
    const { log } = await learnedRig();
    announce(STRANGER);
    announce(STRANGER);
    await until(() => log.of(GATEWAY_LOG.ADDRESS_UNKNOWN).length);
    await sleep(30);
    expect(log.of(GATEWAY_LOG.ADDRESS_UNKNOWN)).toEqual([expect.objectContaining({ address: STRANGER })]);
    expect(registrations()).toEqual([]);
  });

  it('a gateway that takes the line over restores the bindings and does not raise an open claim twice', async () => {
    const book = new MemoryAddressBook();
    const log = new RecordingLog();
    await learnedRig(book, log);
    announce(STRANGER, 'press-01');
    await until(() => registrations().length);
    await rig.gateway.stop();
    rig.gateway = await rig.startGateway();
    announce(STRANGER, 'press-01');
    await sleep(50);
    expect(registrations()).toHaveLength(1);
    expect(log.of(GATEWAY_LOG.RECONCILED).at(-1)).toMatchObject({ addresses: DEFAULT_LINE.machines.length, registrations: 1 });
    expect((await rig.handoff('U3', null, 'press-01')).resolver_payload).toMatchObject({ received: true });
  });
});
