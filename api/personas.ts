import * as personaService from '../services/persona';
import type { LTApiResult } from '../types/sdk';
import type { LTPersonaRelationship } from '../types';

/** Persona keys share the role-name alphabet: kebab/underscore, letter-first. */
const PERSONA_KEY = /^[a-z][a-z0-9_-]*$/;

function validateKey(key: unknown): string | null {
  if (typeof key !== 'string' || !key.trim()) return null;
  const trimmed = key.trim().toLowerCase();
  return PERSONA_KEY.test(trimmed) ? trimmed : null;
}

const RELATIONSHIP_ERROR =
  'relationship must be write-all, write-self, or read-all (write-none is accepted as read-all)';

/**
 * List all personas with their role links and holder counts.
 *
 * @returns `{ status: 200, data: { personas: LTPersonaRecord[] } }` on success
 */
export async function listPersonas(): Promise<LTApiResult> {
  try {
    const personas = await personaService.listPersonas();
    return { status: 200, data: { personas } };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}

/**
 * Retrieve a single persona by key, including its role links and assignees.
 *
 * @param input.key — the persona's stable key
 * @returns `{ status: 200, data: LTPersonaRecord & { assignees } }` or 404
 */
export async function getPersona(input: { key: string }): Promise<LTApiResult> {
  try {
    if (!input.key) {
      return { status: 400, error: 'key is required' };
    }
    const persona = await personaService.getPersona(input.key);
    if (!persona) {
      return { status: 404, error: `Persona '${input.key}' not found` };
    }
    return { status: 200, data: persona };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}

/**
 * Create a persona. The key is trimmed, lowercased, and validated against
 * `^[a-z][a-z0-9_-]*$` (the role-name alphabet).
 *
 * @returns `{ status: 201, data: LTPersonaRecord }` on success, 409 on duplicate key
 */
export async function createPersona(input: {
  key: string;
  title?: string;
  description?: string;
}): Promise<LTApiResult> {
  try {
    const key = validateKey(input.key);
    if (!key) {
      return {
        status: 400,
        error: 'key must start with a letter and contain only lowercase letters, numbers, hyphens, and underscores',
      };
    }
    const persona = await personaService.createPersona({
      key,
      title: input.title,
      description: input.description,
    });
    return { status: 201, data: persona };
  } catch (err: any) {
    if (err.code === '23505') {
      return { status: 409, error: 'Persona with this key already exists' };
    }
    return { status: 500, error: err.message };
  }
}

/**
 * Update a persona's title/description with PATCH semantics — omitted fields
 * keep their values; null clears.
 *
 * @returns `{ status: 200, data: LTPersonaRecord }` or 404
 */
export async function updatePersona(input: {
  key: string;
  title?: string | null;
  description?: string | null;
}): Promise<LTApiResult> {
  try {
    if (!input.key) {
      return { status: 400, error: 'key is required' };
    }
    const persona = await personaService.updatePersona(input.key, {
      title: input.title,
      description: input.description,
    });
    if (!persona) {
      return { status: 404, error: `Persona '${input.key}' not found` };
    }
    return { status: 200, data: persona };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}

/**
 * Delete a persona. Memberships it sustains are removed (or re-homed to a
 * sibling persona the user still holds); direct grants are never touched.
 *
 * @returns `{ status: 200, data: { deleted: true, recompute } }` or 404
 */
export async function deletePersona(input: { key: string }): Promise<LTApiResult> {
  try {
    if (!input.key) {
      return { status: 400, error: 'key is required' };
    }
    const result = await personaService.deletePersona(input.key);
    if (!result.deleted) {
      return { status: 404, error: `Persona '${input.key}' not found` };
    }
    return { status: 200, data: { deleted: true, recompute: result.recompute } };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}

/**
 * Link a role to a persona (or change the link's relationship). Every current
 * holder's memberships are reconciled in the same transaction.
 *
 * @param input.relationship — write-all | write-self | read-all (write-none = read-all)
 * @returns `{ status: 201, data: { role, relationship, recompute } }` or 404
 */
export async function linkPersonaRole(input: {
  key: string;
  role: string;
  relationship: string;
}): Promise<LTApiResult> {
  try {
    if (!input.key || !input.role) {
      return { status: 400, error: 'key and role are required' };
    }
    const role = input.role.trim().toLowerCase();
    if (!PERSONA_KEY.test(role)) {
      return {
        status: 400,
        error: 'Role must start with a letter and contain only lowercase letters, numbers, hyphens, and underscores',
      };
    }
    const relationship = personaService.normalizeRelationship(input.relationship ?? '');
    if (!relationship) {
      return { status: 400, error: RELATIONSHIP_ERROR };
    }
    const result = await personaService.linkPersonaRole(input.key, role, relationship);
    if (!result) {
      return { status: 404, error: `Persona '${input.key}' not found` };
    }
    return { status: 201, data: result };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}

/**
 * Unlink a role from a persona and reconcile every holder's memberships.
 *
 * @returns `{ status: 200, data: { unlinked: true, recompute } }` or 404
 */
export async function unlinkPersonaRole(input: {
  key: string;
  role: string;
}): Promise<LTApiResult> {
  try {
    if (!input.key || !input.role) {
      return { status: 400, error: 'key and role are required' };
    }
    const result = await personaService.unlinkPersonaRole(input.key, input.role);
    if (!result.personaFound) {
      return { status: 404, error: `Persona '${input.key}' not found` };
    }
    if (!result.unlinked) {
      return { status: 404, error: `Persona '${input.key}' does not link role '${input.role}'` };
    }
    return { status: 200, data: { unlinked: true, recompute: result.recompute } };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}

/**
 * Assign a persona to a user — shorthand for adding the user to each linked
 * role at the linked scope. Idempotent: re-assigning overlays fresh from the
 * persona's current links. Direct grants are only ever raised, never lowered.
 *
 * @param input.id — the user's unique identifier
 * @param input.key — the persona key
 * @returns `{ status: 200, data: { assigned: true, recompute } }` or 404
 */
export async function assignPersona(input: {
  id: string;
  key: string;
}): Promise<LTApiResult> {
  try {
    if (!input.id || !input.key) {
      return { status: 400, error: 'user id and persona key are required' };
    }
    const recompute = await personaService.assignPersona(input.id, input.key);
    if (!recompute) {
      return { status: 404, error: `Persona '${input.key}' not found` };
    }
    return { status: 200, data: { assigned: true, recompute } };
  } catch (err: any) {
    if (err.code === '23503') {
      return { status: 404, error: 'User not found' };
    }
    if (err.code === '22P02') {
      return { status: 400, error: 'user id must be a UUID' };
    }
    return { status: 500, error: err.message };
  }
}

/**
 * Unassign a persona from a user. Removes only the memberships the persona
 * sustains; memberships another held persona still grants are re-homed to it,
 * and direct grants are never touched.
 *
 * @returns `{ status: 200, data: { unassigned: true, recompute } }` or 404
 */
export async function unassignPersona(input: {
  id: string;
  key: string;
}): Promise<LTApiResult> {
  try {
    if (!input.id || !input.key) {
      return { status: 400, error: 'user id and persona key are required' };
    }
    const result = await personaService.unassignPersona(input.id, input.key);
    if (!result.personaFound) {
      return { status: 404, error: `Persona '${input.key}' not found` };
    }
    if (!result.unassigned) {
      return { status: 404, error: `User does not hold persona '${input.key}'` };
    }
    return { status: 200, data: { unassigned: true, recompute: result.recompute } };
  } catch (err: any) {
    if (err.code === '22P02') {
      return { status: 400, error: 'user id must be a UUID' };
    }
    return { status: 500, error: err.message };
  }
}

/**
 * The personas a user holds plus the composed role/scope map their memberships
 * form (each row names the sustaining persona, or null for a direct grant).
 *
 * @returns `{ status: 200, data: { personas, roles } }` on success
 */
export async function getUserPersonas(input: { id: string }): Promise<LTApiResult> {
  try {
    if (!input.id) {
      return { status: 400, error: 'user id is required' };
    }
    const result = await personaService.getUserPersonas(input.id);
    return { status: 200, data: result };
  } catch (err: any) {
    if (err.code === '22P02') {
      return { status: 400, error: 'user id must be a UUID' };
    }
    return { status: 500, error: err.message };
  }
}

/**
 * Declarative, idempotent persona seeding — the static-config twin of the API
 * surface. Each spec is authoritative for its persona: title/description
 * overlaid, role links synced (absent links pruned), linked roles ensured, and
 * every holder reconciled so re-running the seed re-applies edits.
 *
 * @param input.personas — array of { key, title?, description?, roles: [{ role, relationship }] }
 * @returns `{ status: 200, data: { personas, links, recompute } }` on success
 */
export async function seedPersonas(input: {
  personas: {
    key: string;
    title?: string;
    description?: string;
    roles?: { role: string; relationship: string }[];
  }[];
}): Promise<LTApiResult> {
  try {
    if (!Array.isArray(input.personas)) {
      return { status: 400, error: 'personas must be an array of persona specs' };
    }
    const specs: {
      key: string;
      title?: string;
      description?: string;
      roles: { role: string; relationship: LTPersonaRelationship }[];
    }[] = [];
    for (const spec of input.personas) {
      const key = validateKey(spec?.key);
      if (!key) {
        return { status: 400, error: `Invalid persona key: '${spec?.key}'` };
      }
      const roles: { role: string; relationship: LTPersonaRelationship }[] = [];
      for (const link of spec.roles ?? []) {
        const role = validateKey(link?.role);
        if (!role) {
          return { status: 400, error: `Persona '${key}': invalid role '${link?.role}'` };
        }
        const relationship = personaService.normalizeRelationship(link?.relationship ?? '');
        if (!relationship) {
          return { status: 400, error: `Persona '${key}', role '${role}': ${RELATIONSHIP_ERROR}` };
        }
        roles.push({ role, relationship });
      }
      specs.push({ key, title: spec.title, description: spec.description, roles });
    }
    const result = await personaService.seedPersonas(specs);
    return { status: 200, data: result };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}
