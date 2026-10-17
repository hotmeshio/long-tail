/**
 * The roles a line needs, as code-owned role declarations: one station role
 * per process (a machine resolves the handoffs into it), the exit role (a
 * person receives finished units) and the operator role (a person decides
 * failed handoffs and closes alarm and machine rows). Each role owns its
 * form; only the operator role enforces it on the server, because handoff
 * rows also collect machine records the gateway already validates.
 */

import type { LTRoleConfig } from '../../types/startup';
import { stationRole, type LineDef } from '../../lib/machines/line';
import { LINE_ROLE } from './contracts';
import { HANDOFF_FORM_SCHEMA, OPERATOR_FORM_SCHEMA } from './forms';

const BOARD = { sla_minutes: 10, target_per_hour: 60, priority_threshold_minutes: 10, ops_visible: true };

export function machineRoleConfigs(line: LineDef): LTRoleConfig[] {
  const stations = [...new Map(line.machines.map((m) => [stationRole(m.process), m])).values()];
  const chain: LTRoleConfig[] = stations.map((m, i) => ({
    role: stationRole(m.process),
    title: `Line: ${m.process}`,
    description: `Units handed to ${m.process}; the machine claims and resolves each handoff.`,
    ...(i > 0 ? { parent_role: stationRole(stations[i - 1].process) } : {}),
    form_schema: HANDOFF_FORM_SCHEMA,
    enforce_schema: false,
    ...BOARD,
  }));
  return [
    ...chain,
    {
      role: LINE_ROLE.EXIT,
      title: 'Line exit',
      description: 'Finished units leaving the line; a person confirms they are in hand.',
      ...(chain.length ? { parent_role: chain[chain.length - 1].role } : {}),
      upstream_roles: [LINE_ROLE.OPERATOR],
      form_schema: HANDOFF_FORM_SCHEMA,
      enforce_schema: false,
      ...BOARD,
    },
    {
      role: LINE_ROLE.OPERATOR,
      title: 'Line operator',
      description: 'Failed handoffs, stopping alarms, and machines that went dark or quiet.',
      form_schema: OPERATOR_FORM_SCHEMA,
      enforce_schema: true,
      ...BOARD,
    },
  ];
}

/** The host's declarations first; line roles only where the host declared none. */
export function withMachineRoles(declared: LTRoleConfig[] = [], lines: LineDef[]): LTRoleConfig[] {
  const out = [...declared];
  const seen = new Set(out.map((r) => r.role));
  for (const line of lines) {
    for (const role of machineRoleConfigs(line)) {
      if (seen.has(role.role)) continue;
      seen.add(role.role);
      out.push(role);
    }
  }
  return out;
}
