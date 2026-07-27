import type { LTReadScope, LTWriteScope } from './users';

/**
 * The membership scope a persona grants on a linked role:
 * write-all = full worker, write-self = acts only on own assignments,
 * read-all = observer (sees the pond, cannot act).
 */
export type LTPersonaRelationship = 'write-all' | 'write-self' | 'read-all';

export interface LTPersonaRole {
  role: string;
  relationship: LTPersonaRelationship;
}

export interface LTPersonaRecord {
  id: string;
  key: string;
  title: string | null;
  description: string | null;
  roles: LTPersonaRole[];
  user_count: number;
  created_at: string;
  updated_at: string;
}

export interface LTPersonaAssignee {
  id: string;
  external_id: string;
  display_name: string | null;
  email: string | null;
  assigned_at: string;
}

export interface LTPersonaDetail extends LTPersonaRecord {
  assignees: LTPersonaAssignee[];
}

/** A persona held by a user (forUser surface). */
export interface LTUserPersona {
  id: string;
  key: string;
  title: string | null;
  description: string | null;
  roles: LTPersonaRole[];
  assigned_at: string;
}

/** One row of the composed role/scope map a user's memberships form. */
export interface LTComposedRoleScope {
  role: string;
  read_scope: LTReadScope;
  write_scope: LTWriteScope;
  /** Key of the persona sustaining the membership; null = direct grant. */
  granted_by_persona: string | null;
}
