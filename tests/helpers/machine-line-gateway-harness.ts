/**
 * The mock line, the machine gateway and a fake Long Tail on one memory
 * broker, plus `handoff()`, which plays one step of the unit workflow: park a
 * handoff row and wait for it to end.
 */

import { MachineGateway, type GatewayDeps, type GatewaySettings } from '../../services/machines/gateway/gateway';
import { silentLog } from '../../services/machines/gateway/log';
import { LINE_ROLE, type HandoffFacets } from '../../services/machines/contracts';
import { machineById, stationRole, type LineDef } from '../../lib/machines/line';
import { DEFAULT_LINE } from '../../examples/workflows/machine-line/line';
import { lineFilter } from '../../lib/machines/protocol';
import { MemoryEscalationFeed, MemoryMachineBus } from '../../lib/machines/transport';
import { FakeLongTail, type FakeRow } from '../../services/machines/testing/fake-long-tail';
import { ROOT, startHarness, type Harness } from './machine-line-fixtures';
import type { MockSettings } from '../../services/machines/testing/mock';

export const GATEWAY_SETTINGS: GatewaySettings = {
  topicRoot: ROOT,
  replyTimeoutMs: 40,
  dispatchAttempts: 2,
  offlineDebounceMs: 10,
  dispatchTtlMs: 60_000,
  quietMs: 0,
};

export interface LineRig extends Harness {
  lt: FakeLongTail;
  feed: MemoryEscalationFeed;
  gateway: MachineGateway;
  startGateway(): Promise<MachineGateway>;
  handoff(units: string | string[], from: string | null, to: string | null, attempt?: number): Promise<FakeRow>;
  park(units: string | string[], from: string | null, to: string | null, attempt?: number): FakeRow;
}

/** Handoff facets for units moving `from` → `to`; jobs are named `${firstUnit}-${machine}`, as `dispatchArgs` names them. */
export function facetsFor(units: string | string[], from: string | null, to: string | null, attempt = 1): HandoffFacets {
  const ids = Array.isArray(units) ? units : [units];
  const def = to ? machineById(DEFAULT_LINE, to) : null;
  const [recipeId, versions] = def ? Object.entries(def.recipes)[0] : [null, []];
  return {
    siteId: DEFAULT_LINE.siteId, lineId: DEFAULT_LINE.lineId,
    units: ids.map((unitId) => ({ unitId, carrierId: `CR-${unitId}` })),
    jobId: `${ids[0]}-${to ?? 'exit'}`, senderJobId: from ? `${ids[0]}-${from}` : null, orderRef: 'ORD-1',
    fromMachine: from, toMachine: to, recipeId, recipeVersion: versions[versions.length - 1] ?? null,
    process: def?.process ?? null, artifactUrl: null, artifactSha256: null, attempt,
  };
}

export async function startRig(
  mock: Partial<MockSettings> = {}, gw: Partial<GatewaySettings> = {}, line: LineDef = DEFAULT_LINE, seams: Pick<GatewayDeps, 'rows' | 'codec' | 'log'> = {},
): Promise<LineRig> {
  const base = await startHarness(mock, line);
  const feed = new MemoryEscalationFeed(base.broker);
  const lt = new FakeLongTail(feed);
  const settings = { ...GATEWAY_SETTINGS, ...gw };

  const startGateway = async () => {
    const gateway = new MachineGateway({
      bus: new MemoryMachineBus(base.broker, lineFilter(ROOT, line.siteId, line.lineId)),
      feed, lt, line, settings, ...seams, log: seams.log ?? silentLog,
    });
    await gateway.start();
    return gateway;
  };

  const park = (units: string | string[], from: string | null, to: string | null, attempt = 1) => {
    const role = to ? stationRole(machineById(DEFAULT_LINE, to).process) : LINE_ROLE.EXIT;
    return lt.park(role, facetsFor(units, from, to, attempt));
  };

  const rig: LineRig = {
    ...base, lt, feed, gateway: await startGateway(), startGateway, park,
    handoff: async (units, from, to, attempt = 1) => lt.ended(park(units, from, to, attempt).id),
    stop: async () => {
      await rig.gateway.stop();
      await base.stop();
    },
  };
  return rig;
}
