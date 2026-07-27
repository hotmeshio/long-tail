import { getPool } from '../../lib/db';
import type {
  LTPersonaRecord,
  LTPersonaRelationship,
  LTPersonaSpec,
  LTUserPersona,
  LTComposedRoleScope,
} from '../../types';

import {
  LIST_PERSONAS,
  GET_PERSONA_BY_KEY,
  GET_PERSONA_ID_BY_KEY,
  GET_PERSONA_ASSIGNEES,
  CREATE_PERSONA,
  UPDATE_PERSONA,
  DELETE_PERSONA,
  UPSERT_PERSONA,
  UPSERT_PERSONA_ROLE,
  DELETE_PERSONA_ROLE,
  SYNC_PERSONA_ROLES,
  INSERT_USER_PERSONA,
  DELETE_USER_PERSONA,
  LIST_PERSONA_HOLDER_IDS,
  RECOMPUTE_PERSONA_MEMBERSHIPS,
  GET_USER_PERSONAS,
  GET_USER_COMPOSED_ROLES,
  ENSURE_ROLES_EXIST,
  LIST_SUSTAINED_USER_IDS,
} from './sql';
import type { CreatePersonaInput, UpdatePersonaInput } from './types';

export {
  PERSONA_RELATIONSHIPS,
  normalizeRelationship,
  relationshipToWriteScope,
} from './types';
export type { CreatePersonaInput, UpdatePersonaInput } from './types';

/** Counts from one membership reconciliation pass. */
export interface PersonaRecomputeResult {
  granted: number;
  refreshed: number;
  raised: number;
  removed: number;
}

/** An assignee row on the persona detail surface. */
export interface PersonaAssignee {
  id: string;
  external_id: string;
  display_name: string | null;
  email: string | null;
  assigned_at: Date;
}

const EMPTY_RECOMPUTE: PersonaRecomputeResult = { granted: 0, refreshed: 0, raised: 0, removed: 0 };

// ─── Internal helpers ─────────────────────────────────────────────────────────

/** Run `work` inside a single transaction on a dedicated client. */
async function withTransaction<T>(
  work: (query: (text: string, params?: any[]) => Promise<any>) => Promise<T>,
): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await work((text, params) => client.query(text, params));
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Reconcile lt_user_roles for a set of users against their held personas. */
async function recomputeMemberships(
  query: (text: string, params?: any[]) => Promise<any>,
  userIds: string[],
): Promise<PersonaRecomputeResult> {
  if (userIds.length === 0) return { ...EMPTY_RECOMPUTE };
  const { rows } = await query(RECOMPUTE_PERSONA_MEMBERSHIPS, [userIds]);
  return rows[0];
}

async function resolvePersonaId(
  query: (text: string, params?: any[]) => Promise<any>,
  key: string,
): Promise<string | null> {
  const { rows } = await query(GET_PERSONA_ID_BY_KEY, [key]);
  return rows[0]?.id ?? null;
}

// ─── Persona CRUD ─────────────────────────────────────────────────────────────

export async function listPersonas(): Promise<LTPersonaRecord[]> {
  const { rows } = await getPool().query(LIST_PERSONAS);
  return rows;
}

export async function getPersona(
  key: string,
): Promise<(LTPersonaRecord & { assignees: PersonaAssignee[] }) | null> {
  const pool = getPool();
  const { rows } = await pool.query(GET_PERSONA_BY_KEY, [key]);
  if (rows.length === 0) return null;
  const { rows: assignees } = await pool.query(GET_PERSONA_ASSIGNEES, [rows[0].id]);
  return { ...rows[0], assignees };
}

export async function createPersona(input: CreatePersonaInput): Promise<LTPersonaRecord> {
  const { rows } = await getPool().query(CREATE_PERSONA, [
    input.key,
    input.title ?? null,
    input.description ?? null,
  ]);
  return { ...rows[0], roles: [], user_count: 0 };
}

export async function updatePersona(
  key: string,
  input: UpdatePersonaInput,
): Promise<LTPersonaRecord | null> {
  const { rows } = await getPool().query(UPDATE_PERSONA, [
    key,
    input.title !== undefined, input.title ?? null,
    input.description !== undefined, input.description ?? null,
  ]);
  if (rows.length === 0) return null;
  const detail = await getPersona(key);
  return detail;
}

/**
 * Delete a persona. Holds are removed and memberships reconciled BEFORE the
 * persona row is deleted, so rows it sustained are dropped (or re-homed to a
 * sibling persona) rather than silently converting into direct grants.
 */
export async function deletePersona(
  key: string,
): Promise<{ deleted: boolean; recompute?: PersonaRecomputeResult }> {
  return withTransaction(async (query) => {
    const personaId = await resolvePersonaId(query, key);
    if (!personaId) return { deleted: false };
    const { rows: holders } = await query(
      `DELETE FROM lt_user_personas WHERE persona_id = $1 RETURNING user_id`,
      [personaId],
    );
    // Guard against drift: also reconcile any user with a row still sustained
    // by this persona, even if no hold record remained.
    const { rows: sustained } = await query(LIST_SUSTAINED_USER_IDS, [personaId]);
    const affected = [...new Set([...holders, ...sustained].map((r) => r.user_id))];
    const recompute = await recomputeMemberships(query, affected);
    await query(DELETE_PERSONA, [personaId]);
    return { deleted: true, recompute };
  });
}

// ─── Role links ───────────────────────────────────────────────────────────────

/**
 * Link a role to a persona (or update the link's relationship). The role is
 * ensured as an FK target, and every current holder's memberships are
 * reconciled in the same transaction.
 */
export async function linkPersonaRole(
  key: string,
  role: string,
  relationship: LTPersonaRelationship,
): Promise<{ role: string; relationship: LTPersonaRelationship; recompute: PersonaRecomputeResult } | null> {
  return withTransaction(async (query) => {
    const personaId = await resolvePersonaId(query, key);
    if (!personaId) return null;
    await query(ENSURE_ROLES_EXIST, [[role]]);
    const { rows } = await query(UPSERT_PERSONA_ROLE, [personaId, role, relationship]);
    const { rows: holders } = await query(LIST_PERSONA_HOLDER_IDS, [personaId]);
    const recompute = await recomputeMemberships(query, holders.map((r: { user_id: string }) => r.user_id));
    return { ...rows[0], recompute };
  });
}

/** Unlink a role from a persona and reconcile every holder's memberships. */
export async function unlinkPersonaRole(
  key: string,
  role: string,
): Promise<{ unlinked: boolean; personaFound: boolean; recompute?: PersonaRecomputeResult }> {
  return withTransaction(async (query) => {
    const personaId = await resolvePersonaId(query, key);
    if (!personaId) return { unlinked: false, personaFound: false };
    const { rowCount } = await query(DELETE_PERSONA_ROLE, [personaId, role]);
    if ((rowCount ?? 0) === 0) return { unlinked: false, personaFound: true };
    const { rows: holders } = await query(LIST_PERSONA_HOLDER_IDS, [personaId]);
    const recompute = await recomputeMemberships(query, holders.map((r: { user_id: string }) => r.user_id));
    return { unlinked: true, personaFound: true, recompute };
  });
}

// ─── Assignment ───────────────────────────────────────────────────────────────

/**
 * Assign a persona to a user. Idempotent: re-assigning overlays fresh — the
 * user's memberships are reconciled against the persona's CURRENT role links
 * (union with every other persona they hold; direct grants only ever raised,
 * never lowered or removed).
 */
export async function assignPersona(
  userId: string,
  key: string,
): Promise<PersonaRecomputeResult | null> {
  return withTransaction(async (query) => {
    const personaId = await resolvePersonaId(query, key);
    if (!personaId) return null;
    await query(INSERT_USER_PERSONA, [userId, personaId]);
    return recomputeMemberships(query, [userId]);
  });
}

/**
 * Unassign a persona from a user. Removes only memberships the persona
 * sustains — rows another held persona still grants are re-homed to it, and
 * direct grants are never touched.
 */
export async function unassignPersona(
  userId: string,
  key: string,
): Promise<{ unassigned: boolean; personaFound: boolean; recompute?: PersonaRecomputeResult }> {
  return withTransaction(async (query) => {
    const personaId = await resolvePersonaId(query, key);
    if (!personaId) return { unassigned: false, personaFound: false };
    const { rowCount } = await query(DELETE_USER_PERSONA, [userId, personaId]);
    if ((rowCount ?? 0) === 0) return { unassigned: false, personaFound: true };
    const recompute = await recomputeMemberships(query, [userId]);
    return { unassigned: true, personaFound: true, recompute };
  });
}

/** The personas a user holds plus the composed role/scope map their memberships form. */
export async function getUserPersonas(
  userId: string,
): Promise<{ personas: LTUserPersona[]; roles: LTComposedRoleScope[] }> {
  const pool = getPool();
  const [{ rows: personas }, { rows: roles }] = await Promise.all([
    pool.query(GET_USER_PERSONAS, [userId]),
    pool.query(GET_USER_COMPOSED_ROLES, [userId]),
  ]);
  return { personas, roles };
}

// ─── Declarative seed ─────────────────────────────────────────────────────────

/**
 * Declarative, idempotent persona seeding — the static-config twin of the API
 * surface (like roles + default_pins in the same seed pass). Each spec is
 * authoritative for its persona: title/description overlaid, role links synced
 * (links absent from the spec are pruned), linked roles ensured as FK targets,
 * and every holder of a seeded persona reconciled — re-running the seed after
 * editing a spec re-applies it to everyone holding the persona.
 *
 * Relationships must be canonical (normalize aliases at the API boundary).
 */
export async function seedPersonas(
  specs: (Omit<LTPersonaSpec, 'roles'> & {
    roles: { role: string; relationship: LTPersonaRelationship }[];
  })[],
): Promise<{ personas: number; links: number; recompute: PersonaRecomputeResult }> {
  if (specs.length === 0) return { personas: 0, links: 0, recompute: { ...EMPTY_RECOMPUTE } };
  return withTransaction(async (query) => {
    const allRoles = [...new Set(specs.flatMap((s) => s.roles.map((r) => r.role)))];
    if (allRoles.length > 0) {
      await query(ENSURE_ROLES_EXIST, [allRoles]);
    }
    const personaIds: string[] = [];
    let links = 0;
    for (const spec of specs) {
      const { rows } = await query(UPSERT_PERSONA, [
        spec.key,
        spec.title ?? null,
        spec.description ?? null,
      ]);
      const personaId = rows[0].id;
      personaIds.push(personaId);
      await query(SYNC_PERSONA_ROLES, [
        personaId,
        spec.roles.map((r) => r.role),
        spec.roles.map((r) => r.relationship),
      ]);
      links += spec.roles.length;
    }
    const { rows: holders } = await query(
      'SELECT DISTINCT user_id FROM lt_user_personas WHERE persona_id = ANY($1::uuid[])',
      [personaIds],
    );
    const recompute = await recomputeMemberships(query, holders.map((r: { user_id: string }) => r.user_id));
    return { personas: specs.length, links, recompute };
  });
}
