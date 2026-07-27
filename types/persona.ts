import type { LTReadScope, LTWriteScope } from './user';

/**
 * The scope of membership a persona grants on a linked role. Maps onto the
 * membership scope lattice (all persona grants are `type='member'`):
 *
 *   write-all  → read all, write all   (full worker: claim, resolve, submit)
 *   write-self → read all, write self  (acts only on own assignments)
 *   read-all   → read all, write none  (observer: sees the pond, cannot act)
 *
 * `write-none` is accepted as an input synonym for `read-all`.
 */
export type LTPersonaRelationship = 'write-all' | 'write-self' | 'read-all';

/** One role link inside a persona. */
export interface LTPersonaRole {
  role: string;
  relationship: LTPersonaRelationship;
  created_at?: Date;
}

/** A persona row with its role links and usage counts. */
export interface LTPersonaRecord {
  id: string;
  key: string;
  title: string | null;
  description: string | null;
  roles: LTPersonaRole[];
  user_count: number;
  created_at: Date;
  updated_at: Date;
}

/** Declarative spec for seeding — the static-config twin of the API surface. */
export interface LTPersonaSpec {
  key: string;
  title?: string;
  description?: string;
  roles: { role: string; relationship: LTPersonaRelationship | 'write-none' }[];
}

/** A persona held by a user, as returned by the forUser surface. */
export interface LTUserPersona {
  id: string;
  key: string;
  title: string | null;
  description: string | null;
  roles: LTPersonaRole[];
  assigned_at: Date;
}

/** One row of the composed role/scope map a user's personas + direct grants produce. */
export interface LTComposedRoleScope {
  role: string;
  read_scope: LTReadScope;
  write_scope: LTWriteScope;
  /** Persona key sustaining the membership, or null for a direct grant. */
  granted_by_persona: string | null;
}
