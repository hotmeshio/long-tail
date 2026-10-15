/**
 * Consolidation roles: the stations an order passes (prep, check), the stage
 * where it waits to be placed, and the container role whose list reads both
 * (examples/workflows/consolidation).
 *
 * The three order roles form one Pace Board sequence through `parent_role`,
 * which the container list names as its look-ahead segment. Schemas are
 * pushed on every boot; titles and dials only on first configure.
 */

import { createRole, updateRoleMetadata, listRolesWithDetails } from '../services/role';
import { loggerRegistry } from '../lib/logger';

import { CONSOLIDATION_ROLES } from './workflows/consolidation';
import {
  CONSOLIDATE_LIST_SCHEMA,
  STATION_FORM_SCHEMA,
  STATION_LIST_SCHEMA,
} from './workflows/consolidation/schemas';

const CONSOLIDATION_ROLE_DEFS = [
  {
    role: CONSOLIDATION_ROLES.PREP,
    title: 'Order · Prep',
    description: 'First station: orders being prepared, each headed to a destination.',
    parent_role: null,
    form_schema: STATION_FORM_SCHEMA,
    list_schema: STATION_LIST_SCHEMA,
  },
  {
    role: CONSOLIDATION_ROLES.CHECK,
    title: 'Order · Check',
    description: 'Second station: orders being checked before they are staged.',
    parent_role: CONSOLIDATION_ROLES.PREP,
    form_schema: STATION_FORM_SCHEMA,
    list_schema: STATION_LIST_SCHEMA,
  },
  {
    role: CONSOLIDATION_ROLES.STAGE,
    title: 'Order · Staged',
    description: 'Orders ready to be placed in their destination\'s container.',
    parent_role: CONSOLIDATION_ROLES.CHECK,
    list_schema: STATION_LIST_SCHEMA,
  },
  {
    role: CONSOLIDATION_ROLES.BIN,
    title: 'Consolidate',
    description: 'Containers filling per destination: what each holds and what is still coming toward it.',
    parent_role: null,
    list_schema: CONSOLIDATE_LIST_SCHEMA,
  },
];

export async function seedConsolidationRoles(): Promise<void> {
  const existing = new Map((await listRolesWithDetails()).map((r) => [r.role, r]));
  for (const def of CONSOLIDATION_ROLE_DEFS) {
    await createRole(def.role);
    const row = existing.get(def.role);
    const unconfigured = row == null || row.title == null;
    try {
      await updateRoleMetadata(def.role, {
        ...(unconfigured
          ? { title: def.title, description: def.description, ops_visible: true, sla_minutes: 60, target_per_hour: 20 }
          : {}),
        parent_role: def.parent_role,
        ...('form_schema' in def ? { form_schema: def.form_schema } : {}),
        list_schema: def.list_schema,
      });
      loggerRegistry.info(`[examples] consolidation role verified (${def.role})`);
    } catch (err: any) {
      loggerRegistry.warn(`[examples] failed to update consolidation role ${def.role}: ${err.message}`);
    }
  }
}
