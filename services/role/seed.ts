import { isDeepStrictEqual } from 'node:util';

import { getPool } from '../../lib/db';
import { loggerRegistry } from '../../lib/logger';
import {
  createRole,
  updateRoleMetadata,
  getEscalationTargets,
  replaceEscalationTargets,
} from './index';
import { GET_ROLE_ROW, LIST_CONFIGURED_ROLES } from './sql';

import type { LTRoleConfig } from '../../types/startup';
import type { UpdateRoleInput } from './types';

export type RoleApplyOutcome = 'applied' | 'unchanged' | 'db-owned';

/** Recorded on schema snapshots written by the startup apply. */
export const STARTUP_CHANGE_SUMMARY = 'startup apply (code)';

/** Metadata fields shared 1:1 between LTRoleConfig and UpdateRoleInput. */
const METADATA_FIELDS = [
  'title', 'description', 'form_schema', 'metadata_schema', 'list_schema',
  'properties', 'ops_visible', 'ops_home_default', 'parent_role',
  'upstream_roles', 'default_pins', 'enforce_schema', 'sla_minutes',
  'target_per_hour', 'worker_count', 'priority_threshold_minutes',
  'priority_facet', 'entity_facet', 'entity_state_source',
] as const;

type MetadataField = (typeof METADATA_FIELDS)[number];

/**
 * Compare one declared field against the stored row. jsonb round-trips lose
 * key order, so structured values must be compared as parsed values — never
 * by string. Arrays compare order-insensitively (sorted).
 */
function fieldDiffers(field: MetadataField, declared: unknown, row: Record<string, any>): boolean {
  const stored = row[field];
  if (Array.isArray(declared)) {
    const a = [...declared].sort();
    const b = Array.isArray(stored) ? [...stored].sort() : [];
    return !isDeepStrictEqual(a, b);
  }
  if (declared !== null && typeof declared === 'object') {
    return !isDeepStrictEqual(declared, stored ?? null);
  }
  // Numeric columns round-trip as strings from the driver — compare as numbers
  // or every declared dial would read as changed on every boot.
  if (typeof declared === 'number') {
    return stored == null || Number(stored) !== declared;
  }
  return declared !== (stored ?? undefined);
}

/** The declared fields that differ from the stored row (PATCH-shaped). */
function diffDeclaredFields(cfg: LTRoleConfig, row: Record<string, any>): UpdateRoleInput {
  const changed: UpdateRoleInput = {};
  for (const field of METADATA_FIELDS) {
    const declared = (cfg as Record<string, any>)[field];
    if (declared === undefined) continue;
    if (fieldDiffers(field, declared, row)) {
      (changed as Record<string, any>)[field] = declared;
    }
  }
  return changed;
}

/**
 * Roles carrying real configuration (title or form schema) — the candidate
 * set for the startup orphan report. Bare FK-ensured rows are excluded.
 */
export async function listConfiguredRoles(): Promise<string[]> {
  const pool = getPool();
  const { rows } = await pool.query(LIST_CONFIGURED_ROLES);
  return rows.map((r: any) => r.role);
}

/**
 * Register one declared role at startup.
 *
 * The role is created if missing. Under code ownership its declared fields
 * are compared against the stored row and written through the versioned
 * PATCH path when they differ — a changed form/metadata schema advances the
 * role's schema version and snapshots the pair; an unchanged declaration is
 * a no-op. Under db ownership the metadata is written exactly once (at
 * creation); afterwards the DB owns the row and drift is warn-logged only.
 * Escalation targets use replace semantics when declared.
 */
export async function applyRoleConfig(
  cfg: LTRoleConfig,
  codeOwned: boolean,
): Promise<RoleApplyOutcome> {
  const created = await createRole(cfg.role);
  const pool = getPool();
  const { rows } = await pool.query(GET_ROLE_ROW, [cfg.role]);
  const row = rows[0] as Record<string, any>;

  const changed = diffDeclaredFields(cfg, row);
  const changedFields = Object.keys(changed);

  const declaredTargets = cfg.escalation_targets != null ? [...cfg.escalation_targets].sort() : null;
  const storedTargets = declaredTargets != null ? await getEscalationTargets(cfg.role) : null;
  const targetsDiffer =
    declaredTargets != null && !isDeepStrictEqual(declaredTargets, [...storedTargets!].sort());

  if (!codeOwned) {
    if (created) {
      // First boot for this role — write the declared metadata once. From
      // here the DB owns the row (the dependents' "only if unconfigured"
      // guard, moved into core).
      if (changedFields.length > 0) {
        await updateRoleMetadata(cfg.role, changed);
      }
      if (targetsDiffer) await replaceEscalationTargets(cfg.role, declaredTargets!);
      return 'applied';
    }
    if (changedFields.length > 0 || targetsDiffer) {
      const drifts = [...changedFields, ...(targetsDiffer ? ['escalation_targets'] : [])];
      loggerRegistry.warn(
        `[long-tail] config drift: role ${cfg.role} — ${drifts.join(', ')} differ between code and DB`,
      );
    }
    return 'db-owned';
  }

  if (changedFields.length === 0 && !targetsDiffer) return 'unchanged';

  if (changedFields.length > 0) {
    await updateRoleMetadata(cfg.role, { ...changed, change_summary: STARTUP_CHANGE_SUMMARY });
  }
  if (targetsDiffer) {
    await replaceEscalationTargets(cfg.role, declaredTargets!);
  }
  return 'applied';
}
