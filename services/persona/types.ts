import type { LTPersonaRelationship, LTWriteScope } from '../../types';

/**
 * Canonical relationship values, ordered by allowance (highest first). A
 * persona grant is always a `member` membership; the relationship selects the
 * point on the work-surface scope lattice the membership stores.
 */
export const PERSONA_RELATIONSHIPS: LTPersonaRelationship[] = ['write-all', 'write-self', 'read-all'];

/** Input synonyms accepted at every surface and normalized to canonical values. */
const RELATIONSHIP_ALIASES: Record<string, LTPersonaRelationship> = {
  'write-none': 'read-all',
};

/** Normalize an input relationship (canonical or alias) — null if unknown. */
export function normalizeRelationship(value: string): LTPersonaRelationship | null {
  if (PERSONA_RELATIONSHIPS.includes(value as LTPersonaRelationship)) {
    return value as LTPersonaRelationship;
  }
  return RELATIONSHIP_ALIASES[value] ?? null;
}

/**
 * The membership scope a relationship grants. Read is always `all` (an
 * observer sees the whole pond); write is the axis the relationship selects.
 */
export function relationshipToWriteScope(relationship: LTPersonaRelationship): LTWriteScope {
  switch (relationship) {
    case 'write-all': return 'all';
    case 'write-self': return 'self';
    case 'read-all': return 'none';
  }
}

// ─── Input types ──────────────────────────────────────────────────────────────

export interface CreatePersonaInput {
  key: string;
  title?: string;
  description?: string;
}

export interface UpdatePersonaInput {
  title?: string | null;
  description?: string | null;
}
