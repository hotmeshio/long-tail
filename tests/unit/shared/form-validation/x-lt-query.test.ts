import { describe, it, expect } from 'vitest';
import { resolveScopedQuery, resolveQueryFacets } from '../../../../shared/form-validation/x-lt-query';

const CTX = { metadata: { walkId: 'walk-7' } };

describe('resolveQueryFacets', () => {
  it('interpolates {{domain.path}} tokens in facet values', () => {
    expect(resolveQueryFacets({ walkId: '{{metadata.walkId}}' }, CTX)).toEqual({ walkId: 'walk-7' });
  });
  it('is empty for no facets', () => {
    expect(resolveQueryFacets(undefined, CTX)).toEqual({});
  });
});

describe('resolveScopedQuery', () => {
  it('assigned:"me" scopes to the viewer and requires a viewer id', () => {
    const scoped = resolveScopedQuery(
      { role: 'child', assigned: 'me', facets: { walkId: '{{metadata.walkId}}' } },
      CTX,
      'viewer-1',
    );
    expect(scoped.assigned_to).toBe('viewer-1');
    expect(scoped.available).toBe(false);
    expect(scoped.facets.walkId).toBe('walk-7');
    expect(scoped.enabled).toBe(true);
  });

  it('assigned:"me" with no viewer id is disabled — never silently widened', () => {
    const scoped = resolveScopedQuery({ role: 'child', assigned: 'me' }, CTX, undefined);
    expect(scoped.enabled).toBe(false);
  });

  it('assigned:"any" drops the ownership constraint', () => {
    const scoped = resolveScopedQuery({ role: 'child', assigned: 'any' }, CTX, 'viewer-1');
    expect(scoped.assigned_to).toBeUndefined();
    expect(scoped.available).toBeUndefined();
  });

  it('omitted assigned gates on the available pool', () => {
    const scoped = resolveScopedQuery({ role: 'child' }, CTX, 'viewer-1');
    expect(scoped.available).toBe(true);
    expect(scoped.assigned_to).toBeUndefined();
  });

  it('is disabled when neither role nor facets are present', () => {
    expect(resolveScopedQuery({}, CTX, 'viewer-1').enabled).toBe(false);
  });
});
