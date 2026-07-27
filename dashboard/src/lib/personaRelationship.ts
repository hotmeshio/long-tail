import type { LTPersonaRelationship, LTReadScope, LTWriteScope } from '../api/types';

// The relationship a persona grants on a linked role, presented the same way
// the member scope picker presents its lattice points (see roleScope.ts).
export interface RelationshipOption {
  value: LTPersonaRelationship;
  label: string;
  read_scope: LTReadScope;
  write_scope: LTWriteScope;
}

export const RELATIONSHIP_OPTIONS: RelationshipOption[] = [
  { value: 'write-all', label: 'Write · act on all', read_scope: 'all', write_scope: 'all' },
  { value: 'write-self', label: 'Write · act on self', read_scope: 'all', write_scope: 'self' },
  { value: 'read-all', label: 'Read-only observer', read_scope: 'all', write_scope: 'none' },
];

export const DEFAULT_RELATIONSHIP: LTPersonaRelationship = 'write-all';

export function relationshipOption(value: string): RelationshipOption {
  return RELATIONSHIP_OPTIONS.find((o) => o.value === value) ?? RELATIONSHIP_OPTIONS[0];
}
