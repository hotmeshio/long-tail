import { describe, it, expect, afterEach } from 'vitest';

import { ROW_TYPE } from '../../../services/machines/contracts';
import { GATEWAY_LOG } from '../../../services/machines/gateway/log';
import { WorkflowStartRefused } from '../../../services/machines/gateway/workflows';
import { FakeLineWorkflows } from '../../../services/machines/testing/fake-workflows';
import { RecordingLog } from '../../../services/machines/testing/recording-log';
import { DEFAULT_LINE } from '../../../examples/workflows/machine-line/line';
import { sleep, until } from '../../helpers/machine-line-fixtures';
import { startRig, type LineRig } from '../../helpers/machine-line-gateway-harness';
import { ACK_OP, reportReceived, requestCodec, watchReceipts, type RequestCodecOptions } from '../../helpers/machine-request-codec';

let rig: LineRig;
afterEach(async () => rig?.stop());

const DESK = 'materialDesk';
const of = (type: string) => rig.lt.ofType(type);
const start = (workflows: FakeLineWorkflows, opts: RequestCodecOptions = { answer: { workflow: { type: DESK } } }, log?: RecordingLog) =>
  startRig({}, { receiptDelayMs: 5 }, DEFAULT_LINE, { codec: requestCodec(opts), workflows, ...(log ? { log } : {}) });

describe('a workflow started for a parked row', () => {
  it('starts once the request row exists, under the row\'s id, with the request as its data', async () => {
    const workflows = new FakeLineWorkflows();
    rig = await start(workflows);
    const id = reportReceived(rig);
    const row = await until(() => of(ROW_TYPE.MACHINE_REQUEST)[0], 2_000);
    await until(() => workflows.started[0], 2_000);
    expect(workflows.started).toEqual([{
      type: DESK, workflowId: `machine-request-${row.id}`,
      data: { rowId: row.id, type: ROW_TYPE.MACHINE_REQUEST, siteId: DEFAULT_LINE.siteId, lineId: DEFAULT_LINE.lineId, machineId: 'press-01', op: ACK_OP, ref: id, event: expect.objectContaining({ tag: 'EPC-1' }) },
    }]);
  });

  it('three deliveries start it once', async () => {
    const workflows = new FakeLineWorkflows();
    rig = await start(workflows);
    const id = reportReceived(rig);
    await until(() => workflows.started[0], 2_000);
    reportReceived(rig, 'press-01', id);
    reportReceived(rig, 'press-01', id);
    await sleep(80);
    expect(workflows.started).toHaveLength(1);
  });

  it('a new gateway starts nothing for an open row', async () => {
    const workflows = new FakeLineWorkflows();
    rig = await start(workflows);
    reportReceived(rig);
    await until(() => workflows.started[0], 2_000);
    await rig.gateway.stop();
    rig.gateway = await rig.startGateway();
    await sleep(80);
    expect(workflows.started).toHaveLength(1);
    expect(workflows.repeats).toBe(0);
  });

  it('a start refused for its configuration is logged, and the message is still confirmed', async () => {
    const workflows = new FakeLineWorkflows();
    workflows.failNext = new WorkflowStartRefused(`${DESK}: Workflow not found`);
    const log = new RecordingLog();
    rig = await start(workflows, undefined, log);
    const confirmed = watchReceipts(rig);
    const id = reportReceived(rig);
    await until(() => confirmed.includes(id), 2_000);
    expect(log.of(GATEWAY_LOG.ROW_WORKFLOW_FAILED)).toHaveLength(1);
    expect(of(ROW_TYPE.MACHINE_REQUEST)).toHaveLength(1);
  });

  it('any other failure leaves the message unconfirmed; it comes again and the start runs then', async () => {
    const workflows = new FakeLineWorkflows();
    workflows.failNext = new Error('connection reset');
    rig = await start(workflows);
    const confirmed = watchReceipts(rig);
    const id = reportReceived(rig);
    await until(() => workflows.started[0], 3_000);
    await until(() => confirmed.includes(id), 2_000);
    expect(of(ROW_TYPE.MACHINE_REQUEST)).toHaveLength(1);
    expect(workflows.started).toHaveLength(1);
  });

  it('a notice starts its workflow the same way, with no op', async () => {
    const workflows = new FakeLineWorkflows();
    rig = await start(workflows, { notice: { kind: 'material-removed', workflow: { type: 'lotLedger' } } });
    reportReceived(rig);
    const row = await until(() => of(ROW_TYPE.MACHINE_NOTICE)[0], 2_000);
    await until(() => workflows.started[0], 2_000);
    expect(workflows.started[0]).toMatchObject({ type: 'lotLedger', workflowId: `machine-notice-${row.id}`, data: { rowId: row.id, type: ROW_TYPE.MACHINE_NOTICE } });
    expect(workflows.started[0].data.op).toBeUndefined();
  });
});
