import { describe, it, expect, afterEach } from 'vitest';

import { CHANNEL, DISPATCH_ON, JOB_EVENT, TRANSFER_FAILURE, buildEnvelope, genericCodec, machineTopic } from '../../../lib/machines/protocol';
import { identOf, operatorRole } from '../../../lib/machines/line';
import { DEFAULT_LINE } from '../../../examples/workflows/machine-line/line';
import { HANDOFF_ERROR, ROW_TYPE } from '../../../services/machines/contracts';
import { ROOT, sleep, until } from '../../helpers/machine-line-fixtures';
import { startRig, type LineRig } from '../../helpers/machine-line-gateway-harness';

let rig: LineRig;
afterEach(async () => rig?.stop());

const onArrival = { codec: genericCodec({ root: ROOT, dispatchOn: DISPATCH_ON.ARRIVAL }) };

function scan(body: Record<string, unknown>): void {
  const ident = identOf(DEFAULT_LINE, 'press-01');
  rig.broker.publish(machineTopic(ROOT, ident, CHANNEL.JOB), JSON.stringify(buildEnvelope(ident, { orderRef: 'ORD-1', recipe: null, ...body })));
}

const unmatchedRows = () => rig.lt.ofType(ROW_TYPE.HANDOFF_ERROR).filter((r) => r.metadata.errorCode === HANDOFF_ERROR.UNMATCHED_ARRIVAL);

describe('an arrival no handoff expects', () => {
  it('is shown to the operator role once every delivery has passed, with the raw arrival', async () => {
    rig = await startRig({ autoArriveAtEntry: false }, {}, DEFAULT_LINE, onArrival);
    scan({ event: JOB_EVENT.TRANSFER_FAILED, reason: TRANSFER_FAILURE.UNREADABLE_ID });
    await until(() => unmatchedRows().length === 1);
    const [row] = unmatchedRows();
    expect(row).toMatchObject({ role: operatorRole(DEFAULT_LINE), status: 'pending' });
    expect(row.metadata).toMatchObject({ machineId: 'press-01', carrierId: null, event: JOB_EVENT.TRANSFER_FAILED, siteId: 'site-1', lineId: 'line-1' });
    expect(row.metadata.arrival).toMatchObject({ reason: TRANSFER_FAILURE.UNREADABLE_ID });
  });

  it('is raised once per machine and carrier, and again once a person has resolved it', async () => {
    rig = await startRig({ autoArriveAtEntry: false }, {}, DEFAULT_LINE, onArrival);
    scan({ event: JOB_EVENT.ARRIVED, carrierId: 'CR-9' });
    await until(() => unmatchedRows().length === 1);
    scan({ event: JOB_EVENT.ARRIVED, carrierId: 'CR-9' });
    await sleep(300);
    expect(unmatchedRows()).toHaveLength(1);
    expect(unmatchedRows()[0].metadata.carrierId).toBe('CR-9');
    rig.lt.personResolves(unmatchedRows()[0].id, { decision: 'rescan' });
    scan({ event: JOB_EVENT.ARRIVED, carrierId: 'CR-9' });
    await until(() => unmatchedRows().length === 2);
  });

  it('is not raised for a carrier an open handoff into the machine names', async () => {
    rig = await startRig({ autoArriveAtEntry: false }, {}, DEFAULT_LINE, onArrival);
    const row = rig.park('U1', null, 'press-01');
    scan({ event: JOB_EVENT.ARRIVED, carrierId: 'CR-U1' });
    await rig.lt.ended(row.id);
    await sleep(200);
    expect(unmatchedRows()).toHaveLength(0);
  });
});
