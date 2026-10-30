import { describe, it, expect, afterEach } from 'vitest';

import { OP } from '../../../lib/machines/protocol';
import { stationRole } from '../../../lib/machines/line';
import { facetsFor, startRig, type LineRig } from '../../helpers/machine-line-gateway-harness';
import { DEFAULT_LINE } from '../../../examples/workflows/machine-line/line';

let rig: LineRig;
afterEach(async () => rig?.stop());

/** A handoff into press-01 whose units each carry their own file and, for the first, its own parameters. */
function intoPress(units: { unitId: string; artifact?: { url: string; sha256: string } }[], extra: Record<string, unknown> = {}) {
  return rig.lt.park(stationRole('bond'), {
    ...facetsFor(units.map((u) => u.unitId), null, 'press-01'),
    units: units.map((u, i) => ({ unitId: u.unitId, carrierId: `CR-${u.unitId}`, ...(u.artifact ? { artifact: u.artifact } : {}), ...(i === 0 ? { parameters: { trimPath: `p-${u.unitId}` } } : {}) })),
    ...extra,
  });
}

describe('dispatch: parameters and per-unit files', () => {
  it('the machine receives the job\'s parameters and each unit\'s file and parameters, and verifies every file', async () => {
    rig = await startRig();
    const files = ['P1', 'P2'].map((unitId) => ({ unitId, artifact: rig.line.payloads.put(Buffer.from(`model ${unitId}`)) }));
    const units = files.map(({ unitId, artifact }) => ({ unitId, artifact: { url: artifact.url, sha256: artifact.sha256 } }));
    const ended = await rig.lt.ended(intoPress(units, { parameters: { dwellS: 6, profile: 'A' } }).id, 3_000);
    expect(ended.resolver_payload).toMatchObject({ received: true, units: ['P1', 'P2'] });
    const [dispatch] = rig.recorder.commands('press-01', OP.DISPATCH);
    expect(dispatch.args.parameters).toEqual({ dwellS: 6, profile: 'A' });
    expect(dispatch.args.units).toMatchObject([
      { unitId: 'P1', artifact: units[0].artifact, parameters: { trimPath: 'p-P1' } },
      { unitId: 'P2', artifact: units[1].artifact },
    ]);
  });

  it('one unit\'s file failing its checksum fails the dispatch, naming the unit', async () => {
    rig = await startRig();
    const good = rig.line.payloads.put(Buffer.from('model Q1'));
    const bad = rig.line.payloads.put(Buffer.from('model Q2'));
    const ended = await rig.lt.ended(intoPress([
      { unitId: 'Q1', artifact: { url: good.url, sha256: good.sha256 } },
      { unitId: 'Q2', artifact: { url: bad.url, sha256: 'ef'.repeat(32) } },
    ]).id);
    expect(ended.resolver_payload).toMatchObject({ received: false, errorCode: 'dispatch-refused' });
    expect(ended.resolver_payload!.detail).toMatch(/Q2: artifact checksum mismatch/);
  });

  it('a machine that requires an artifact takes a row whose every unit has its own', async () => {
    const line = { ...DEFAULT_LINE, machines: DEFAULT_LINE.machines.map((m) => (m.machineId === 'press-01' ? { ...m, requireArtifact: true } : m)) };
    rig = await startRig({}, {}, line);
    const file = rig.line.payloads.put(Buffer.from('model R1'));
    const ended = await rig.lt.ended(intoPress([{ unitId: 'R1', artifact: { url: file.url, sha256: file.sha256 } }]).id, 3_000);
    expect(ended.resolver_payload).toMatchObject({ received: true });
    expect(rig.recorder.commands('press-01', OP.DISPATCH)).toHaveLength(1);
  });

  it('a unit with several files sends them all, each with its id, type and size, and satisfies a machine that requires an artifact', async () => {
    const line = { ...DEFAULT_LINE, machines: DEFAULT_LINE.machines.map((m) => (m.machineId === 'press-01' ? { ...m, requireArtifact: true } : m)) };
    rig = await startRig({}, {}, line);
    const files = [
      { url: 'https://files/S1.step', sha256: 'ab'.repeat(32), id: 'ART-1', contentType: 'model/step', sizeBytes: 2048 },
      { url: 'https://files/S1.nc', sha256: 'cd'.repeat(32), id: 'ART-2', contentType: 'text/plain', sizeBytes: 512 },
    ];
    const row = rig.lt.park(stationRole('bond'), { ...facetsFor('S1', null, 'press-01'), units: [{ unitId: 'S1', carrierId: 'CR-S1', artifacts: files }] });
    expect((await rig.lt.ended(row.id, 3_000)).resolver_payload).toMatchObject({ received: true });
    expect(rig.recorder.commands('press-01', OP.DISPATCH)[0].args.units[0].artifacts).toEqual(files);
  });
});
