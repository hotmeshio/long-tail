import { describe, it, expect } from 'vitest';
import { UPDATE_ROLE_METADATA, LIST_ROLES_WITH_DETAILS } from '../../../services/role/sql';

// ─────────────────────────────────────────────────────────────────────────────
// SQL shape for the entity dials. The dials ride the same one-statement PATCH
// ladder as every other role column: a boolean "provided" sentinel guards each
// write so an update that omits a dial can never clobber it.
// ─────────────────────────────────────────────────────────────────────────────

describe('UPDATE_ROLE_METADATA — entity dial ladder', () => {
  it('writes entity_facet only behind its $37 provided sentinel', () => {
    expect(UPDATE_ROLE_METADATA).toMatch(
      /entity_facet\s+=\s+CASE WHEN \$37::boolean THEN \$38\s+ELSE entity_facet\s+END/,
    );
  });

  it('writes entity_state_source behind $39, defaulting null to the role source', () => {
    expect(UPDATE_ROLE_METADATA).toMatch(
      /CASE WHEN \$39::boolean THEN COALESCE\(\$40, 'role'\)\s+ELSE entity_state_source END/,
    );
  });

  it('returns both dials so PATCH responses echo the stored values', () => {
    const returning = UPDATE_ROLE_METADATA.slice(UPDATE_ROLE_METADATA.indexOf('RETURNING'));
    expect(returning).toContain('entity_facet');
    expect(returning).toContain('entity_state_source');
  });
});

describe('LIST_ROLES_WITH_DETAILS — entity dial projection', () => {
  it('selects both dials for role listings', () => {
    expect(LIST_ROLES_WITH_DETAILS).toContain('r.entity_facet');
    expect(LIST_ROLES_WITH_DETAILS).toContain('r.entity_state_source');
  });
});
