import { describe, it, expect, afterEach } from 'vitest';

import { facetsFor, startRig, type LineRig } from '../../helpers/machine-line-gateway-harness';

let rig: LineRig;
afterEach(async () => rig?.stop());

describe('traceability on the handoff row', () => {
  it('the sender\'s lots for each unit land on the row as searchable facets', async () => {
    rig = await startRig();
    await rig.handoff(['U1', 'U2'], null, 'press-01');
    const intoCut = await rig.handoff(['U1', 'U2'], 'press-01', 'cut-01');
    expect(intoCut.resolver_payload).toMatchObject({ received: true });
    const md = rig.lt.rows.get(intoCut.id)!.metadata;
    expect(md.lots).toEqual(['L-1001', 'L-1002']);
    expect(md.trace.map((e: any) => [e.unitId, e.machineId, e.result])).toEqual([['U1', 'press-01', 'ok'], ['U2', 'press-01', 'ok']]);
    expect(md.trace[0].materials).toEqual([{ material: 'BONDING-FILM', lot: 'L-1001' }, { material: 'TOP-LAYER', lot: 'L-1002' }]);
  });

  it('a rejected unit is traced too, with its result', async () => {
    rig = await startRig();
    rig.line.arm('press-01', { result: 'reject', reason: 'BOND-WEAK' });
    await rig.handoff('U1', null, 'press-01');
    const intoCut = await rig.handoff('U1', 'press-01', 'cut-01');
    expect(intoCut.resolver_payload).toMatchObject({ errorCode: 'sender-rejected' });
    expect(rig.lt.rows.get(intoCut.id)!.metadata.trace[0]).toMatchObject({ unitId: 'U1', result: 'reject' });
  });

  it('a gateway that takes the line part way through a row keeps the trace already written', async () => {
    rig = await startRig();
    await rig.handoff(['U1', 'U2'], null, 'press-01');
    await rig.gateway.stop();
    const written = { unitId: 'U0', machineId: 'press-01', jobId: 'J0', result: 'ok', materials: [{ material: 'OLD', lot: 'L-0' }] };
    const row = rig.lt.park('line-trim', { ...facetsFor(['U1', 'U2'], 'press-01', 'cut-01'), trace: [written] } as any);
    rig.gateway = await rig.startGateway();
    await rig.lt.ended(row.id, 5_000);
    const md = rig.lt.rows.get(row.id)!.metadata;
    expect(md.trace.map((e: any) => e.unitId).sort()).toEqual(['U0', 'U1', 'U2']);
    expect(md.lots).toEqual(['L-0', 'L-1001', 'L-1002']);
  });
});
