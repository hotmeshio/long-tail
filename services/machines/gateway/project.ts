/**
 * The line as its leader sees it, for the dashboard: each machine's link,
 * held units, open rows and alarms from the gateway state, and the claims
 * waiting for a person. Pure: reads the state and the line, changes nothing.
 */

import { learnsAddress, machineRole, type LineDef, type MachineDef } from '../../../lib/machines/line';
import { isoTs } from '../../../lib/machines/protocol';
import type { LineView, MachineAlarmView, MachineView } from '../../../types/machines-view';
import type { GatewayState, HandoffRow } from './state';

const at = (ms: number | undefined): string | null => (ms ? isoTs(ms) : null);

function addressOf(state: GatewayState, line: LineDef, def: MachineDef): string | null {
  if (learnsAddress(line, def.machineId)) return state.learnedAddress(def.machineId) ?? null;
  return def.address ?? def.machineId;
}

function alarmsOf(state: GatewayState, machineId: string): MachineAlarmView[] {
  return [...state.alarms.values()]
    .filter((track) => track.machineId === machineId)
    .map((track) => ({ alarmId: track.alarmId, level: track.level ?? '', raisedAt: track.raisedAt ?? '', rowId: track.rowId ?? null }));
}

/** The handoff that brought a unit into a machine: open first, then the recently closed one. */
function rowCarrying(state: GatewayState, machineId: string, unitId: string): HandoffRow | undefined {
  const into = (r: HandoffRow) => r.toMachine === machineId;
  return state.openFor(unitId, into) ?? state.closedFor(unitId, into);
}

function machineView(state: GatewayState, line: LineDef, def: MachineDef): MachineView {
  const m = def.machineId;
  const link = state.links.get(m);
  const open = state.open();
  return {
    machineId: m, process: def.process, role: machineRole(def), address: addressOf(state, line, def),
    online: link ? link.online : null, since: at(link?.since), lastSeen: at(link?.lastSeen),
    software: link?.software ?? null, bootId: link?.bootId ?? null, sessionId: link?.sessionId ?? null,
    heldUnits: state.heldUnitsAt(m).map(({ unitId }) => {
      const row = rowCarrying(state, m, unitId);
      return { unitId, carrierId: row?.units.find((u) => u.unitId === unitId)?.carrierId ?? null, rowId: row?.id ?? '' };
    }),
    rows: {
      handoff: open.filter((r) => r.toMachine === m).length,
      command: state.openCommandsFor(m),
      alarm: [...state.alarms.values()].filter((t) => t.machineId === m && t.open && !!t.rowId).length,
      offlineRowId: link?.rowId ?? null, quietRowId: link?.quietRowId ?? null,
    },
    alarms: alarmsOf(state, m),
    jobs: link?.jobs ?? [],
  };
}

export function projectLine(state: GatewayState, line: LineDef): LineView {
  return {
    siteId: line.siteId, lineId: line.lineId, leading: true, takenAt: at(state.takenAt),
    machines: line.machines.map((def) => machineView(state, line, def)),
    contested: state.contested(),
  };
}
