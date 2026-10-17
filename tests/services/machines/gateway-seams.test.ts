import { describe, it, expect, afterEach } from 'vitest';

import { genericCodec, RECEIPT_FROM } from '../../../lib/machines/protocol';
import { machineById } from '../../../lib/machines/line';
import { DEFAULT_LINE } from '../../../examples/workflows/machine-line/line';
import { ROW_TYPE } from '../../../services/machines/contracts';
import type { HandoffRowAdapter } from '../../../services/machines/rows';
import { lineIdentities } from '../../../services/machines/gateway/provision';
import { machineRoleConfigs } from '../../../services/machines/roles';
import { ROOT, until } from '../../helpers/machine-line-fixtures';
import { facetsFor, startRig, type LineRig } from '../../helpers/machine-line-gateway-harness';
import { GATEWAY_LOG } from '../../../services/machines/gateway/log';
import { RecordingLog } from '../../../services/machines/testing/recording-log';

let rig: LineRig;
afterEach(async () => rig?.stop());

// A host's own station row: its own type and facets, nothing about machines.
const STATION_STEP = 'station-step';
const hostRows: HandoffRowAdapter = {
  openRows: () => [{ type: STATION_STEP }],
  toHandoff: (row) => {
    if (row.type !== STATION_STEP) return null;
    const md = row.metadata ?? {};
    const def = machineById(DEFAULT_LINE, md.station);
    const [recipeId, versions] = Object.entries(def.recipes)[0];
    return {
      siteId: md.plant, lineId: md.cell, units: md.parts.map((p: any) => ({ unitId: p.serial, carrierId: p.plate })),
      jobId: `${md.order}-${md.station}`, senderJobId: md.previous ? `${md.order}-${md.previous}` : null, orderRef: md.order,
      fromMachine: md.previous ?? null, toMachine: md.station, recipeId, recipeVersion: versions[versions.length - 1],
      process: def.process, artifactUrl: null, artifactSha256: null, attempt: 1,
    };
  },
};

function step(order: string, station: string, previous: string | null) {
  return rig.lt.parkRow({
    type: STATION_STEP, role: `station-${station}`,
    metadata: { plant: 'site-1', cell: 'line-1', order, station, previous, parts: [{ serial: `${order}-S1`, plate: `P-${order}` }] },
  });
}

describe('gateway seams: a host\'s rows', () => {
  it('resolves rows the host parks in its own shape, read by its adapter', async () => {
    rig = await startRig({}, {}, DEFAULT_LINE, { rows: hostRows });
    expect((await rig.lt.ended(step('O1', 'press-01', null).id)).resolver_payload).toMatchObject({ received: true });
    const intoCut = await rig.lt.ended(step('O1', 'cut-01', 'press-01').id);
    expect(intoCut).toMatchObject({ status: 'resolved', resolved_by: 'cut-01' });
    expect(intoCut.items.map((i) => i.itemKey).sort()).toEqual(['arrived:O1-S1', 'released:O1-S1']);
  });

  it('picks up the host\'s open rows when it starts leading', async () => {
    rig = await startRig({}, {}, DEFAULT_LINE, { rows: hostRows });
    await rig.gateway.stop();
    const row = step('O2', 'press-01', null);
    rig.gateway = await rig.startGateway();
    expect((await rig.lt.ended(row.id)).status).toBe('resolved');
  });

  it('leaves rows the adapter does not claim alone', async () => {
    rig = await startRig({}, {}, DEFAULT_LINE, { rows: hostRows });
    const other = rig.lt.parkRow({ type: 'review', role: 'reviewer', metadata: { plant: 'site-1', cell: 'line-1' } });
    await rig.gateway.idle();
    expect(rig.lt.calls.filter((c) => c.id === other.id)).toEqual([]);
  });
});

describe('gateway seams: the wire', () => {
  it('a codec that takes the receiver\'s start as its receipt still closes the handoff', async () => {
    rig = await startRig({}, {}, DEFAULT_LINE, { codec: genericCodec({ root: ROOT, receiptFrom: RECEIPT_FROM.STARTED }) });
    await rig.handoff('U1', null, 'press-01');
    const intoCut = await rig.handoff('U1', 'press-01', 'cut-01');
    expect(intoCut.resolver_payload).toMatchObject({ received: true });
    expect(intoCut.items.map((i) => i.itemKey)).toContain('arrived:U1');
  });
});

describe('gateway seams: role names from the line', () => {
  const named = { ...structuredClone(DEFAULT_LINE), roles: { exit: 'inspector', operator: 'supervisor' } };
  named.machines[0].role = 'press-cell';

  it('puts machine bots on the roles of people who take units straight from a machine', () => {
    const withReceivers = { ...named, roles: { ...named.roles, receivers: ['harvester'] } };
    const [controller, press] = lineIdentities(withReceivers);
    expect(press.roles).toEqual(['press-cell', 'line-trim', 'line-inspect', 'inspector', 'harvester']);
    expect(controller.roles).toEqual(['press-cell', 'line-trim', 'line-inspect', 'inspector', 'harvester', 'supervisor']);
  });

  it('declares and assigns the line\'s own role names', () => {
    expect(machineRoleConfigs(named).map((r) => r.role)).toEqual(['press-cell', 'line-trim', 'line-inspect', 'inspector', 'supervisor']);
    const [controller, press] = lineIdentities(named);
    expect(press.roles).toEqual(['press-cell', 'line-trim', 'line-inspect', 'inspector']);
    expect(controller.roles).toContain('supervisor');
  });

  it('raises alarm rows on the line\'s operator role', async () => {
    rig = await startRig({}, {}, named);
    await rig.line.fault('press-01', { code: 'F-101' });
    const alarm = await until(() => [...rig.lt.rows.values()].find((r) => r.type === ROW_TYPE.ALARM), 2_000);
    expect(alarm.role).toBe('supervisor');
  });
});

describe('gateway seams: a row outside a machine\'s roles', () => {
  it('logs when a machine cannot see the row it records a release on', async () => {
    const log = new RecordingLog();
    rig = await startRig({}, {}, DEFAULT_LINE, { log });
    rig.lt.holds.set('press-01', new Set(['line-bond', 'line-exit']));
    await rig.handoff('U1', null, 'press-01');
    rig.lt.parkRow({ type: ROW_TYPE.HANDOFF, role: 'harvester', metadata: { ...facetsFor('U1', 'press-01', null) } });
    await until(() => log.of(GATEWAY_LOG.ROW_NOT_VISIBLE).length, 2_000);
    expect(log.of(GATEWAY_LOG.ROW_NOT_VISIBLE)[0]).toMatchObject({ action: 'accumulate', as: 'press-01', role: 'harvester' });
  });
});
