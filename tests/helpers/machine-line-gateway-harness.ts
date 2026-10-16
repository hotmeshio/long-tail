/**
 * The mock line, the machine gateway and a fake Long Tail on one memory
 * broker, plus `handoff()`, which plays one step of the unit workflow: park a
 * handoff row and wait for it to end.
 */

import { MachineGateway, type GatewaySettings } from '../../examples/workflows/machine-line/gateway/gateway';
import { silentLog } from '../../examples/workflows/machine-line/gateway/log';
import { LINE_ROLE, type HandoffFacets } from '../../examples/workflows/machine-line/contracts';
import { DEFAULT_LINE, machineById, stationRole } from '../../examples/workflows/machine-line/line';
import { lineFilter } from '../../examples/workflows/machine-line/protocol';
import { MemoryEscalationFeed, MemoryMachineBus } from '../../examples/workflows/machine-line/transport';
import { FakeLongTail, type FakeRow } from './machine-line-lt-fake';
import { ROOT, startHarness, type Harness } from './machine-line-fixtures';
import type { MockSettings } from '../../examples/workflows/machine-line/mock';

export const GATEWAY_SETTINGS: GatewaySettings = {
  topicRoot: ROOT,
  replyTimeoutMs: 40,
  dispatchAttempts: 2,
  offlineDebounceMs: 10,
  dispatchTtlMs: 60_000,
};

export interface LineRig extends Harness {
  lt: FakeLongTail;
  feed: MemoryEscalationFeed;
  gateway: MachineGateway;
  startGateway(): Promise<MachineGateway>;
  handoff(unitId: string, from: string | null, to: string | null, attempt?: number): Promise<FakeRow>;
  park(unitId: string, from: string | null, to: string | null, attempt?: number): FakeRow;
}

export function facetsFor(unitId: string, from: string | null, to: string | null, attempt = 1): HandoffFacets {
  const def = to ? machineById(DEFAULT_LINE, to) : null;
  const [recipeId, versions] = def ? Object.entries(def.recipes)[0] : [null, []];
  return {
    unitId, jobId: `${unitId}-${to ?? 'exit'}`, carrierId: 'CR-1', orderRef: 'ORD-1',
    fromMachine: from, toMachine: to, recipeId, recipeVersion: versions[versions.length - 1] ?? null,
    process: def?.process ?? null, artifactUrl: null, artifactSha256: null, attempt,
  };
}

export async function startRig(mock: Partial<MockSettings> = {}, gw: Partial<GatewaySettings> = {}): Promise<LineRig> {
  const base = await startHarness(mock);
  const feed = new MemoryEscalationFeed(base.broker);
  const lt = new FakeLongTail(feed);
  const settings = { ...GATEWAY_SETTINGS, ...gw };

  const startGateway = async () => {
    const gateway = new MachineGateway({
      bus: new MemoryMachineBus(base.broker, lineFilter(ROOT, DEFAULT_LINE.siteId, DEFAULT_LINE.lineId)),
      feed, lt, line: DEFAULT_LINE, settings, log: silentLog,
    });
    await gateway.start();
    return gateway;
  };

  const park = (unitId: string, from: string | null, to: string | null, attempt = 1) => {
    const role = to ? stationRole(machineById(DEFAULT_LINE, to).process) : LINE_ROLE.EXIT;
    return lt.park(role, facetsFor(unitId, from, to, attempt));
  };

  const rig: LineRig = {
    ...base, lt, feed, gateway: await startGateway(), startGateway, park,
    handoff: async (unitId, from, to, attempt = 1) => lt.ended(park(unitId, from, to, attempt).id),
    stop: async () => {
      await rig.gateway.stop();
      await base.stop();
    },
  };
  return rig;
}
