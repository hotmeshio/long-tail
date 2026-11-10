import { describe, it, expect, afterEach } from 'vitest';

import { ROW_TYPE } from '../../../services/machines/contracts';
import { CONTROLLER } from '../../../services/machines/gateway/actions';
import { GATEWAY_LOG } from '../../../services/machines/gateway/log';
import { RecordingLog } from '../../../services/machines/testing/recording-log';
import { machineRole, machineById } from '../../../lib/machines/line';
import { DEFAULT_LINE } from '../../../examples/workflows/machine-line/line';
import { sleep, until } from '../../helpers/machine-line-fixtures';
import { startRig, type LineRig } from '../../helpers/machine-line-gateway-harness';
import { ACK_OP, reportReceived, requestCodec, watchReceipts, type RequestCodecOptions } from '../../helpers/machine-request-codec';

let rig: LineRig;
afterEach(async () => rig?.stop());

const start = (opts: RequestCodecOptions = {}, log?: RecordingLog) => startRig({}, { receiptDelayMs: 5 }, DEFAULT_LINE, { codec: requestCodec(opts), ...(log ? { log } : {}) });
const requests = () => rig.lt.ofType(ROW_TYPE.MACHINE_REQUEST);
const parked = () => until(() => requests()[0], 2_000);

describe('machine requests', () => {
  it('a message asking for an answer parks one row on the machine\'s role, however often it is delivered', async () => {
    rig = await start();
    const id = reportReceived(rig);
    const row = await parked();
    reportReceived(rig, 'press-01', id);
    reportReceived(rig, 'press-01', id);
    await sleep(80);
    expect(requests()).toHaveLength(1);
    expect(row.role).toBe(machineRole(machineById(DEFAULT_LINE, 'press-01')));
    expect(row.subtype).toBe(ACK_OP);
    expect(row.metadata).toMatchObject({ siteId: DEFAULT_LINE.siteId, lineId: DEFAULT_LINE.lineId, machineId: 'press-01', op: ACK_OP, ref: id });
    expect(row.metadata.event).toMatchObject({ message_name: 'material-received', tag: 'EPC-1' });
  });

  it('the message is confirmed only once its row exists; a failed park is delivered again', async () => {
    rig = await start();
    const confirmed = watchReceipts(rig);
    rig.lt.failNext('create');
    const id = reportReceived(rig);
    await parked();
    await until(() => confirmed.includes(id), 2_000);
    expect(requests()).toHaveLength(1);
  });

  it('the answer is sent once, naming the message, and the row resolves sent without waiting for a reply', async () => {
    rig = await start();
    const id = reportReceived(rig);
    const row = await parked();
    await rig.lt.answer(row.id, { accepted: true, lot: 'LOT-7' }, 'workflow-bot');
    const ended = await rig.lt.ended(row.id);
    expect(ended.resolved_by).toBe(CONTROLLER);
    expect(ended.resolver_payload).toMatchObject({ answered: true, status: 'sent', op: ACK_OP, ref: id, machineId: 'press-01', answeredBy: 'workflow-bot' });
    await rig.gateway.idle();
    const sent = rig.recorder.commands('press-01', ACK_OP);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ args: { accepted: true, lot: 'LOT-7' }, respondingTo: id });
  });

  it('an answer may name another op the line allows', async () => {
    rig = await start({ rowOps: [{ op: ACK_OP, reply: false }, { op: 'reject-material', reply: false }] });
    reportReceived(rig);
    const row = await parked();
    await rig.lt.answer(row.id, { reason: 'unpaired' }, 'person-1', 'reject-material');
    expect((await rig.lt.ended(row.id)).resolver_payload).toMatchObject({ status: 'sent', op: 'reject-material' });
    expect(rig.recorder.commands('press-01', ACK_OP)).toEqual([]);
  });

  it('an answer the codec cannot send resolves unsupported, and nothing goes out', async () => {
    rig = await start({ encodes: false });
    reportReceived(rig);
    const row = await parked();
    await rig.lt.answer(row.id, {});
    expect((await rig.lt.ended(row.id)).resolver_payload).toMatchObject({ answered: false, status: 'unsupported' });
    expect(rig.recorder.commands('press-01', ACK_OP)).toEqual([]);
  });

  it('a request resolved or cancelled by anyone else ends with no answer sent', async () => {
    rig = await start();
    reportReceived(rig);
    const first = await parked();
    rig.lt.personResolves(first.id, { note: 'handled at the machine' });
    reportReceived(rig);
    const second = await until(() => requests()[1], 2_000);
    rig.lt.cancel(second.id);
    await sleep(80);
    await rig.gateway.idle();
    expect(rig.recorder.commands('press-01', ACK_OP)).toEqual([]);
    expect(rig.gateway.state.requests.size).toBe(0);
  });

  it('an answer op the line does not allow is refused: no row, and the message is still confirmed', async () => {
    const log = new RecordingLog();
    rig = await start({ answer: { op: 'launch' } }, log);
    const confirmed = watchReceipts(rig);
    const id = reportReceived(rig);
    await until(() => confirmed.includes(id), 2_000);
    expect(requests()).toEqual([]);
    expect(log.of(GATEWAY_LOG.REQUEST_REFUSED)[0]).toMatchObject({ machine: 'press-01' });
  });

  it('a codec that asks for no answer parks nothing', async () => {
    rig = await startRig({}, { receiptDelayMs: 5 });
    reportReceived(rig);
    await sleep(80);
    expect(requests()).toEqual([]);
  });
});
