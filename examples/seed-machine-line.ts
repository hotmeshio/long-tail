/**
 * Machine line roles: one station role per process on the line (a machine
 * resolves the handoffs into it), line-exit (a person receives finished
 * units), and line-operator (a person decides failed handoffs and closes
 * alarm and machine rows). Each role owns its form; only line-operator
 * enforces it on the server, because handoff rows also collect machine
 * records that the line protocol already validates at the gateway.
 *
 * Pace Board: line-<first> → … → line-<last> → line-exit, with
 * line-operator merging in.
 */

import { createRole, listRolesWithDetails, updateRoleMetadata } from '../services/role';
import { loggerRegistry } from '../lib/logger';

import { LINE_ROLE } from './workflows/machine-line/contracts';
import { HANDOFF_FORM_SCHEMA, OPERATOR_FORM_SCHEMA } from './workflows/machine-line/forms';
import { loadLine, stationRole } from './workflows/machine-line/line';

interface LineRoleConfig {
  role: string;
  title: string;
  description: string;
  parent_role: string | null;
  upstream_roles?: string[];
  form_schema: Record<string, any>;
  enforce_schema: boolean;
}

export function machineLineRoleData(lineConfigPath = process.env.MACHINE_LINE_CONFIG || undefined): LineRoleConfig[] {
  const line = loadLine(lineConfigPath);
  const stations = [...new Map(line.machines.map((m) => [stationRole(m.process), m])).values()];
  const chain: LineRoleConfig[] = stations.map((m, i) => ({
    role: stationRole(m.process),
    title: `Line: ${m.process}`,
    description: `Units handed to ${m.process}; the machine claims and resolves each handoff.`,
    parent_role: i === 0 ? null : stationRole(stations[i - 1].process),
    form_schema: HANDOFF_FORM_SCHEMA,
    enforce_schema: false,
  }));
  return [
    ...chain,
    {
      role: LINE_ROLE.EXIT,
      title: 'Line exit',
      description: 'Finished units leaving the line; a person confirms they are in hand.',
      parent_role: chain.length ? chain[chain.length - 1].role : null,
      upstream_roles: [LINE_ROLE.OPERATOR],
      form_schema: HANDOFF_FORM_SCHEMA,
      enforce_schema: false,
    },
    {
      role: LINE_ROLE.OPERATOR,
      title: 'Line operator',
      description: 'Failed handoffs, stopping alarms, and machines that went dark or quiet.',
      parent_role: null,
      form_schema: OPERATOR_FORM_SCHEMA,
      enforce_schema: true,
    },
  ];
}

export async function seedMachineLineRoles(): Promise<void> {
  const data = machineLineRoleData();
  const existing = new Map((await listRolesWithDetails()).map((r) => [r.role, r]));
  const created = new Set<string>();
  for (const d of data) {
    try {
      if (await createRole(d.role)) created.add(d.role);
    } catch { /* ON CONFLICT DO NOTHING */ }
  }
  for (const d of data) {
    const row = existing.get(d.role);
    if (!created.has(d.role) && !(row != null && row.title == null)) continue;
    try {
      await updateRoleMetadata(d.role, {
        title: d.title,
        description: d.description,
        ops_visible: true,
        parent_role: d.parent_role,
        sla_minutes: 10,
        target_per_hour: 60,
        priority_threshold_minutes: 10,
        ...(d.upstream_roles ? { upstream_roles: d.upstream_roles } : {}),
        form_schema: d.form_schema,
        enforce_schema: d.enforce_schema,
      });
    } catch (err: any) {
      loggerRegistry.warn(`[examples] failed to update machine line role ${d.role}: ${err.message}`);
    }
  }
  loggerRegistry.info(`[examples] machine line roles verified (${data.map((d) => d.role).join(', ')})`);
}
