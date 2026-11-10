import { describe, it, expect, afterEach } from 'vitest';

import { DECISION, ROW_TYPE } from '../../../services/machines/contracts';
import { machineRole, machineById, operatorRole } from '../../../lib/machines/line';
import { DEFAULT_LINE } from '../../../examples/workflows/machine-line/line';
import type { NoticeRequest } from '../../../lib/machines/protocol';
import { sleep, until } from '../../helpers/machine-line-fixtures';
import { startRig, type LineRig } from '../../helpers/machine-line-gateway-harness';
import { ACK_OP, reportReceived, requestCodec, watchReceipts, type RequestCodecOptions } from '../../helpers/machine-request-codec';

let rig: LineRig;
afterEach(async () => rig?.stop());

const WITHIN_MS = 60;
const REMOVED = 'material-removed';
const start = (notice: NoticeRequest = { kind: REMOVED }, more: Partial<RequestCodecOptions> = {}) =>
  startRig({}, { receiptDelayMs: 5 }, DEFAULT_LINE, { codec: requestCodec({ notice, ...more }) });
const of = (type: string) => rig.lt.ofType(type);
const parked = () => until(() => of(ROW_TYPE.MACHINE_NOTICE)[0], 2_000);

describe('machine notices', () => {
  it('a message to record parks one notice row on the machine\'s role, however often it is delivered', async () => {
    rig = await start();
    const id = reportReceived(rig);
    const row = await parked();
    reportReceived(rig, 'press-01', id);
    reportReceived(rig, 'press-01', id);
    await sleep(80);
    expect(of(ROW_TYPE.MACHINE_NOTICE)).toHaveLength(1);
    expect(row.role).toBe(machineRole(machineById(DEFAULT_LINE, 'press-01')));
    expect(row.subtype).toBe(REMOVED);
    expect(row.metadata).toMatchObject({ machineId: 'press-01', ref: id, kind: REMOVED, event: { tag: 'EPC-1' } });
    expect(row.metadata.op).toBeUndefined();
    expect(of(ROW_TYPE.MACHINE_REQUEST)).toEqual([]);
  });

  it('the message is confirmed only once its row exists', async () => {
    rig = await start();
    const confirmed = watchReceipts(rig);
    rig.lt.failNext('create');
    const id = reportReceived(rig);
    await parked();
    await until(() => confirmed.includes(id), 2_000);
    expect(of(ROW_TYPE.MACHINE_NOTICE)).toHaveLength(1);
  });

  it('whoever records it resolves the row, and nothing is sent to the machine', async () => {
    rig = await start();
    reportReceived(rig);
    const row = await parked();
    rig.lt.personResolves(row.id, { recorded: true, remaining: 190 });
    await rig.lt.ended(row.id);
    await sleep(40);
    await rig.gateway.idle();
    expect(rig.recorder.commands('press-01')).toEqual([]);
  });

  it('a notice unrecorded past its window is shown to the operators once, and that row closes when it is recorded', async () => {
    rig = await start({ kind: REMOVED, withinMs: WITHIN_MS });
    reportReceived(rig);
    const notice = await parked();
    const late = await until(() => of(ROW_TYPE.REQUEST_OVERDUE)[0], 2_000);
    expect(late.role).toBe(operatorRole(DEFAULT_LINE));
    expect(late.metadata).toMatchObject({ requestId: notice.id, rowType: ROW_TYPE.MACHINE_NOTICE });
    expect(late.description).toMatch(/to be recorded/);
    rig.lt.personResolves(notice.id, { recorded: true });
    expect((await rig.lt.ended(late.id)).resolver_payload).toMatchObject({ decision: DECISION.RECORDED });
  });

  it('a new gateway watches an open notice from its creation, and parks nothing new', async () => {
    rig = await start({ kind: REMOVED, withinMs: WITHIN_MS * 2 });
    const id = reportReceived(rig);
    await parked();
    await rig.gateway.stop();
    rig.gateway = await rig.startGateway();
    reportReceived(rig, 'press-01', id);
    await until(() => of(ROW_TYPE.REQUEST_OVERDUE)[0], 2_000);
    await sleep(40);
    expect(of(ROW_TYPE.MACHINE_NOTICE)).toHaveLength(1);
    expect(of(ROW_TYPE.REQUEST_OVERDUE)).toHaveLength(1);
  });

  it('a message marked both ways is a request', async () => {
    rig = await start({ kind: REMOVED }, { answer: { op: ACK_OP } });
    reportReceived(rig);
    await until(() => of(ROW_TYPE.MACHINE_REQUEST)[0], 2_000);
    expect(of(ROW_TYPE.MACHINE_NOTICE)).toEqual([]);
  });
});
