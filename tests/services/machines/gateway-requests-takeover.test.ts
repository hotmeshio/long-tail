import { describe, it, expect, afterEach } from 'vitest';

import { DECISION, ROW_TYPE } from '../../../services/machines/contracts';
import { operatorRole } from '../../../lib/machines/line';
import { DEFAULT_LINE } from '../../../examples/workflows/machine-line/line';
import { sleep, until } from '../../helpers/machine-line-fixtures';
import { startRig, type LineRig } from '../../helpers/machine-line-gateway-harness';
import { ACK_OP, reportReceived, requestCodec } from '../../helpers/machine-request-codec';

let rig: LineRig;
afterEach(async () => rig?.stop());

const WITHIN_MS = 60;
const start = (withinMs?: number) => startRig({}, {}, DEFAULT_LINE, { codec: requestCodec(withinMs ? { answer: { withinMs } } : {}) });
const of = (type: string) => rig.lt.ofType(type);
const parked = () => until(() => of(ROW_TYPE.MACHINE_REQUEST)[0], 2_000);
const overdue = () => until(() => of(ROW_TYPE.REQUEST_OVERDUE)[0], 2_000);

describe('machine requests: windows and takeover', () => {
  it('a request unanswered past its window is shown to the line\'s operators once; answering it closes that row', async () => {
    rig = await start(WITHIN_MS);
    const id = reportReceived(rig);
    const request = await parked();
    const late = await overdue();
    expect(late.role).toBe(operatorRole(DEFAULT_LINE));
    expect(late.metadata).toMatchObject({ requestId: request.id, machineId: 'press-01', ref: id, op: ACK_OP });
    await sleep(WITHIN_MS * 2);
    expect(of(ROW_TYPE.REQUEST_OVERDUE)).toHaveLength(1);
    await rig.lt.answer(request.id, { accepted: true });
    expect((await rig.lt.ended(request.id)).resolver_payload).toMatchObject({ status: 'sent' });
    expect((await rig.lt.ended(late.id)).resolver_payload).toMatchObject({ decision: DECISION.ANSWERED });
    expect(rig.recorder.commands('press-01', ACK_OP)).toHaveLength(1);
  });

  it('a request answered inside its window raises no overdue row', async () => {
    rig = await start(WITHIN_MS * 3);
    reportReceived(rig);
    const request = await parked();
    await rig.lt.answer(request.id, {});
    await rig.lt.ended(request.id);
    await sleep(WITHIN_MS * 4);
    expect(of(ROW_TYPE.REQUEST_OVERDUE)).toEqual([]);
  });

  it('a new gateway watches an open request from its creation, and the message read again parks nothing new', async () => {
    rig = await start(WITHIN_MS * 2);
    const id = reportReceived(rig);
    await parked();
    await rig.gateway.stop();
    rig.gateway = await rig.startGateway();
    reportReceived(rig, 'press-01', id);
    await overdue();
    await sleep(40);
    expect(of(ROW_TYPE.MACHINE_REQUEST)).toHaveLength(1);
    expect(of(ROW_TYPE.REQUEST_OVERDUE)).toHaveLength(1);
  });

  it('an answer added while no gateway led the line is sent once by the next', async () => {
    rig = await start();
    const id = reportReceived(rig);
    const request = await parked();
    await rig.gateway.stop();
    await rig.lt.answer(request.id, { accepted: false, reason_code: 'UNPAIRED' });
    await sleep(20);
    expect(rig.lt.rows.get(request.id)!.status).toBe('pending');
    rig.gateway = await rig.startGateway();
    expect((await rig.lt.ended(request.id)).resolver_payload).toMatchObject({ status: 'sent', ref: id });
    await rig.gateway.idle();
    expect(rig.recorder.commands('press-01', ACK_OP)).toHaveLength(1);
  });

  it('an overdue row raised before a takeover is not raised again, and closes when the request ends', async () => {
    rig = await start(WITHIN_MS);
    reportReceived(rig);
    const request = await parked();
    const late = await overdue();
    await rig.gateway.stop();
    rig.gateway = await rig.startGateway();
    await sleep(WITHIN_MS * 2);
    expect(of(ROW_TYPE.REQUEST_OVERDUE)).toHaveLength(1);
    rig.lt.cancel(request.id);
    expect((await rig.lt.ended(late.id)).resolver_payload).toMatchObject({ decision: DECISION.ANSWERED });
  });

  it('an open overdue row whose request ended while no gateway led the line is closed by the next', async () => {
    rig = await start(WITHIN_MS);
    reportReceived(rig);
    const request = await parked();
    const late = await overdue();
    await rig.gateway.stop();
    rig.lt.cancel(request.id);
    rig.gateway = await rig.startGateway();
    expect((await rig.lt.ended(late.id)).resolver_payload).toMatchObject({ decision: DECISION.ANSWERED });
  });
});
