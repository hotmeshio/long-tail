/**
 * Printer-twin role config — the STATIC startup declaration that puts the twin
 * farm on the Pace Board AND declares each human role's escalation-surface
 * schema. Mirrors seed-ortho.ts: create the bare role rows, then layer titles,
 * dials, sequence edges, and the versioned `form_schema` that describes what a
 * servicer submits when resolving that role's escalations.
 *
 * The escalation FORM belongs to the ROLE (never the workflow, never inline on
 * the escalation): print-onboarder owns the registration form, print-servicer
 * owns the service form. The twin raises escalations to these roles; the
 * dashboard renders the role's schema.
 *
 * Topology (Pace Board):
 *   print-jobs ─▶ printer-fleet          the production line (demand → print)
 *                    ▲    ▲
 *   print-onboarder ─┘    └── print-servicer   onboarding + maintenance, merge in
 */

import { createRole, updateRoleMetadata, listRolesWithDetails } from '../services/role';
import { loggerRegistry } from '../lib/logger';

import { PRINT_ONBOARDER, PRINT_SERVICER, PRINTER_FLEET, PRINT_JOBS } from './workflows/printer-twin/types';
import { REGISTRATION_FORM_SCHEMA, SERVICE_FORM_SCHEMA } from './workflows/printer-twin/forms';

interface TwinRoleConfig {
  role: string;
  title: string;
  description: string;
  parent_role: string | null;
  sla_minutes: number;
  target_per_hour: number;
  priority_threshold_minutes: number;
  upstream_roles?: string[];
  /** The role's escalation-surface schema (what a human submits to resolve). */
  form_schema?: Record<string, any>;
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
    // Newly onboarded and freshly serviced machines re-enter the pool here —
    // cross-sequence merges, drawn as the merge glyph.
    upstream_roles: [PRINT_ONBOARDER, PRINT_SERVICER],
    sla_minutes: 5,
    target_per_hour: 30,
    priority_threshold_minutes: 5,
  },
  {
    role: PRINT_ONBOARDER,
    title: 'Print Onboarder',
    description: 'Register + bind a newly unboxed machine — captures its identity and capabilities.',
    parent_role: null, // segment root: the onboarding surface
    sla_minutes: 15,
    target_per_hour: 5,
    priority_threshold_minutes: 15,
    form_schema: REGISTRATION_FORM_SCHEMA,
  },
  {
    role: PRINT_SERVICER,
    title: 'Print Servicer',
    description: 'Reload filament, inspect failures, and restore machines that fell offline.',
    parent_role: null, // segment root: the maintenance surface
    sla_minutes: 10,
    target_per_hour: 10,
    priority_threshold_minutes: 10,
    form_schema: SERVICE_FORM_SCHEMA,
  },
];

export async function seedTwinRoles(): Promise<void> {
  // Worker-config registration creates bare role rows before this seeder runs,
  // so a role is seedable when createRole inserts it OR when it exists untitled;
  // a role the admin has already configured keeps its titles, dials, and schema.
  const existing = new Map((await listRolesWithDetails()).map((r) => [r.role, r]));

  // 1. Ensure every bare row exists first — parent_role and upstream_roles
  //    reference lt_roles, so all must be present before metadata applies.
  const createdRoles = new Set<string>();
  for (const data of TWIN_ROLE_DATA) {
    try {
      if (await createRole(data.role)) createdRoles.add(data.role);
    } catch { /* ON CONFLICT DO NOTHING */ }
  }

  // 2. Layer titles, dials, sequence edges, and the role's escalation schema.
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
        ...(data.form_schema ? { form_schema: data.form_schema } : {}),
      });
    } catch (err: any) {
      loggerRegistry.warn(`[examples] failed to update twin role ${data.role}: ${err.message}`);
    }
  }

  const seq = TWIN_ROLE_DATA.map((d) => d.role).join(', ');
  loggerRegistry.info(`[examples] twin roles verified (${seq})`);
}
