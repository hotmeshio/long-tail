/**
 * Printer-twin role config — the STATIC startup declaration that puts the twin
 * farm on the Pace Board. Mirrors seed-ortho.ts: create the bare role rows, then
 * layer titles, dials, and the parent/upstream edges that the Operations view
 * renders as sequence fragments.
 *
 * Topology (two segments):
 *   print-jobs ─▶ printer-fleet          the production line (demand → print)
 *                    ▲
 *                    └── print-servicer   maintenance side-quest, merges in
 *
 * `ops_visible` is the "operationalized & tracked" flag — only these roles show
 * on the board. `parent_role` is the single prior step (roots start a segment);
 * `upstream_roles` is the cross-sequence merge glyph, not a parent edge.
 */

import { createRole, updateRoleMetadata, listRolesWithDetails } from '../services/role';
import { loggerRegistry } from '../lib/logger';

import { PRINT_SERVICER, PRINTER_FLEET, PRINT_JOBS } from './workflows/printer-twin/types';

interface TwinRoleConfig {
  role: string;
  title: string;
  description: string;
  parent_role: string | null;
  sla_minutes: number;
  target_per_hour: number;
  priority_threshold_minutes: number;
  upstream_roles?: string[];
}

const TWIN_ROLE_DATA: TwinRoleConfig[] = [
  {
    role: PRINT_JOBS,
    title: 'Print Jobs',
    description: 'Order demand — one print-job escalation per unit, claimed as a set.',
    parent_role: null, // segment root: the production line starts here
    sla_minutes: 5,
    target_per_hour: 30,
    priority_threshold_minutes: 5,
  },
  {
    role: PRINTER_FLEET,
    title: 'Printer Fleet',
    description: 'Twin availability adverts and in-flight print rows — the machines at work.',
    parent_role: PRINT_JOBS, // demand flows into the fleet where it is consumed
    // A serviced/registered machine re-enters the pool here — a cross-sequence
    // merge, drawn as the merge glyph rather than a bend in the main line.
    upstream_roles: [PRINT_SERVICER],
    sla_minutes: 5,
    target_per_hour: 30,
    priority_threshold_minutes: 5,
  },
  {
    role: PRINT_SERVICER,
    title: 'Print Servicer',
    description: 'The human line — register unboxed machines and restore ones that fell offline.',
    parent_role: null, // segment root: its own maintenance side-quest
    sla_minutes: 10,
    target_per_hour: 10,
    priority_threshold_minutes: 10,
  },
];

export async function seedTwinRoles(): Promise<void> {
  // Worker-config registration creates bare role rows before this seeder runs,
  // so a role is seedable when createRole inserts it OR when it exists untitled;
  // a role the admin has already configured keeps its titles and dials.
  const existing = new Map((await listRolesWithDetails()).map((r) => [r.role, r]));

  // 1. Ensure every bare row exists first — parent_role and upstream_roles
  //    reference lt_roles, so all three must be present before metadata applies.
  const createdRoles = new Set<string>();
  for (const data of TWIN_ROLE_DATA) {
    try {
      if (await createRole(data.role)) createdRoles.add(data.role);
    } catch { /* ON CONFLICT DO NOTHING */ }
  }

  // 2. Layer titles, dials, and sequence edges onto unconfigured roles.
  for (const data of TWIN_ROLE_DATA) {
    const created = createdRoles.has(data.role);
    const row = existing.get(data.role);
    const unconfigured = row != null && row.title == null;
    if (!created && !unconfigured) continue;
    try {
      await updateRoleMetadata(data.role, {
        title: data.title,
        description: data.description,
        ops_visible: true,
        parent_role: data.parent_role,
        sla_minutes: data.sla_minutes,
        target_per_hour: data.target_per_hour,
        priority_threshold_minutes: data.priority_threshold_minutes,
        ...(data.upstream_roles ? { upstream_roles: data.upstream_roles } : {}),
      });
    } catch (err: any) {
      loggerRegistry.warn(`[examples] failed to update twin role ${data.role}: ${err.message}`);
    }
  }

  const seq = TWIN_ROLE_DATA.map((d) => d.role).join(', ');
  loggerRegistry.info(`[examples] twin roles verified (${seq})`);
}
