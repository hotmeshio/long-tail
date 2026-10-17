/**
 * Machine line roles for the examples: the shipped role declarations
 * (services/machines/roles.ts) for the demo line or MACHINE_LINE_CONFIG,
 * applied insert-if-absent so an admin's tuning survives restarts.
 */

import { createRole, listRolesWithDetails, updateRoleMetadata } from '../services/role';
import { loggerRegistry } from '../lib/logger';
import { machineRoleConfigs } from '../services/machines/roles';
import type { LTRoleConfig } from '../types/startup';
import { loadLine } from './workflows/machine-line/line';

export function machineLineRoleData(lineConfigPath = process.env.MACHINE_LINE_CONFIG || undefined): LTRoleConfig[] {
  return machineRoleConfigs(loadLine(lineConfigPath));
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
        parent_role: d.parent_role ?? null,
        sla_minutes: d.sla_minutes,
        target_per_hour: d.target_per_hour,
        priority_threshold_minutes: d.priority_threshold_minutes,
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
