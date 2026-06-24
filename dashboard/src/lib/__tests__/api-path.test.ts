import { describe, it, expect } from 'vitest';
import { buildApiPath } from '../api-path';

describe('buildApiPath', () => {
  it('appends only present params and skips empty/undefined/null', () => {
    const path = buildApiPath('/escalations', {
      status: 'pending',
      role: '',
      type: undefined,
      priority: null,
      limit: 25,
      offset: 0,
    });
    expect(path).toBe('/escalations?status=pending&limit=25&offset=0');
  });

  it('returns the bare base when no params are present', () => {
    expect(buildApiPath('/escalations/available', { role: '', search: undefined })).toBe('/escalations/available');
  });

  it('includes the search term and reflects the full active param set', () => {
    const path = buildApiPath('/escalations', {
      assigned_to: 'user-1',
      status: 'pending',
      role: 'reviewer',
      type: 'intake',
      search: 'order 42',
      sort_by: 'created_at',
      order: 'desc',
      limit: 25,
      offset: 50,
    });
    // search is URL-encoded; every active filter is present
    expect(path).toContain('search=order+42');
    expect(path).toContain('assigned_to=user-1');
    expect(path).toContain('status=pending');
    expect(path).toContain('role=reviewer');
    expect(path).toContain('type=intake');
    expect(path).toContain('sort_by=created_at&order=desc');
    expect(path).toContain('offset=50');
  });

  it('coerces numbers and booleans to strings', () => {
    expect(buildApiPath('/x', { claimed: true, limit: 10 })).toBe('/x?claimed=true&limit=10');
  });
});
