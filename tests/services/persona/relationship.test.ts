import { describe, it, expect } from 'vitest';

import {
  PERSONA_RELATIONSHIPS,
  normalizeRelationship,
  relationshipToWriteScope,
} from '../../../services/persona/types';

// ─────────────────────────────────────────────────────────────────────────────
// Relationship vocabulary
//
// A persona link's relationship names a point on the member scope lattice.
// Canonical values pass through; 'write-none' is an accepted alias for
// 'read-all'; anything else is rejected (null).
// ─────────────────────────────────────────────────────────────────────────────

describe('persona relationships', () => {
  it('exposes the canonical values ordered by allowance', () => {
    expect(PERSONA_RELATIONSHIPS).toEqual(['write-all', 'write-self', 'read-all']);
  });

  it('normalizes canonical values to themselves', () => {
    for (const value of PERSONA_RELATIONSHIPS) {
      expect(normalizeRelationship(value)).toBe(value);
    }
  });

  it('normalizes the write-none alias to read-all', () => {
    expect(normalizeRelationship('write-none')).toBe('read-all');
  });

  it('rejects unknown values', () => {
    expect(normalizeRelationship('')).toBeNull();
    expect(normalizeRelationship('admin')).toBeNull();
    expect(normalizeRelationship('WRITE-ALL')).toBeNull();
    expect(normalizeRelationship('read-self')).toBeNull();
  });

  it('maps each relationship onto the write-scope axis (read is always all)', () => {
    expect(relationshipToWriteScope('write-all')).toBe('all');
    expect(relationshipToWriteScope('write-self')).toBe('self');
    expect(relationshipToWriteScope('read-all')).toBe('none');
  });
});
