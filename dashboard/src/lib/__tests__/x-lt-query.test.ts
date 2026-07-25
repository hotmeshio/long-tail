import { describe, it, expect } from 'vitest';
import { resolveScopedQuery, type EmbedQuery } from '../x-lt-query';

const CTX = { metadata: { originId: 'origin-7' } };

const WALK_QUERY: EmbedQuery = {
  role: 'print-harvest',
  facets: { originId: '{{metadata.originId}}' },
};

describe('resolveScopedQuery — ownership scope', () => {
  it('assigned:"me" scopes to the viewer\'s live claims (assigned_to + available:false)', () => {
    const scoped = resolveScopedQuery({ ...WALK_QUERY, assigned: 'me' }, CTX, 'walker-1');
    expect(scoped.assigned_to).toBe('walker-1');
    expect(scoped.available).toBe(false);
    expect(scoped.facets.originId).toBe('origin-7');
    expect(scoped.status).toBe('pending');
    expect(scoped.enabled).toBe(true);
  });

  it('assigned:"me" without a viewer identity disables rather than widening scope', () => {
    const scoped = resolveScopedQuery({ ...WALK_QUERY, assigned: 'me' }, CTX, undefined);
    expect(scoped.enabled).toBe(false);
  });

  it('assigned:"any" applies no ownership constraint', () => {
    const scoped = resolveScopedQuery({ ...WALK_QUERY, assigned: 'any' }, CTX, 'walker-1');
    expect(scoped.assigned_to).toBeUndefined();
    expect(scoped.available).toBeUndefined();
    expect(scoped.enabled).toBe(true);
  });

  it('omitted assigned defaults to the available pool', () => {
    const scoped = resolveScopedQuery(WALK_QUERY, CTX, 'walker-1');
    expect(scoped.assigned_to).toBeUndefined();
    expect(scoped.available).toBe(true);
  });

  it('a declared legacy available value is honored when assigned is omitted', () => {
    const scoped = resolveScopedQuery({ ...WALK_QUERY, available: false }, CTX, 'walker-1');
    expect(scoped.available).toBe(false);
  });

  it('status defaults to pending; a declared status passes through', () => {
    expect(resolveScopedQuery(WALK_QUERY, CTX, 'w').status).toBe('pending');
    expect(resolveScopedQuery({ ...WALK_QUERY, status: 'resolved' }, CTX, 'w').status).toBe('resolved');
  });

  it('disables when neither role nor facets are declared', () => {
    const scoped = resolveScopedQuery({}, CTX, 'walker-1');
    expect(scoped.enabled).toBe(false);
  });
});
