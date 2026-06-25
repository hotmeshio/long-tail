import { describe, it, expect } from 'vitest';

import {
  searchEscalationsQuery,
  COUNT_SEARCH_ESCALATIONS,
  RESOLVE_BY_METADATA_ATOMIC,
} from '../../../services/escalation/sql';

describe('search SQL — read-scope self branch', () => {
  const sql = searchEscalationsQuery('priority ASC, created_at ASC');

  it('unions read_all and read_self (assigned_to = me) role visibility', () => {
    expect(sql).toContain('role = ANY($3)');
    expect(sql).toContain('role = ANY($10) AND assigned_to = $11');
  });

  it('global access (no role filter) is the both-null branch', () => {
    expect(sql).toContain('$3::text[] IS NULL AND $10::text[] IS NULL');
  });

  it('paginates after the two new scope params ($12 limit, $13 offset)', () => {
    expect(sql).toContain('LIMIT $12 OFFSET $13');
  });

  it('the count query shares the scope predicate (no limit/offset)', () => {
    expect(COUNT_SEARCH_ESCALATIONS).toContain('role = ANY($10) AND assigned_to = $11');
    expect(COUNT_SEARCH_ESCALATIONS).not.toContain('LIMIT');
  });
});

describe('resolve-by-metadata SQL — write-scope self branch', () => {
  it('folds write_all ($5) and write_self ($6 + assigned_to = $2) into the FOR UPDATE target', () => {
    expect(RESOLVE_BY_METADATA_ATOMIC).toContain('$5::text[] IS NULL');
    expect(RESOLVE_BY_METADATA_ATOMIC).toContain('role = ANY($5)');
    expect(RESOLVE_BY_METADATA_ATOMIC).toContain('role = ANY($6::text[]) AND assigned_to = $2');
    expect(RESOLVE_BY_METADATA_ATOMIC).toContain('FOR UPDATE');
  });
});
