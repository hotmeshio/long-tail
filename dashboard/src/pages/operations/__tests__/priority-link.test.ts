import { describe, it, expect } from 'vitest';
import { priorityQueueLink } from '../priority-link';

describe('priorityQueueLink', () => {
  it('orders by the metadata facet when the role configures one', () => {
    const link = priorityQueueLink({ role: 'gluer', priority_facet: 'authorized_at' });
    const url = new URL(link, 'http://localhost');
    expect(url.pathname).toBe('/escalations/available');
    expect(url.searchParams.get('role')).toBe('gluer');
    expect(JSON.parse(url.searchParams.get('orderBy')!)).toEqual([
      { field: 'metadata.authorized_at', direction: 'asc' },
    ]);
  });

  it('falls back to created_at ascending when no facet is configured', () => {
    const link = priorityQueueLink({ role: 'gluer', priority_facet: null });
    const url = new URL(link, 'http://localhost');
    expect(url.searchParams.get('sort_by')).toBe('created_at');
    expect(url.searchParams.get('order')).toBe('asc');
    expect(url.searchParams.get('orderBy')).toBeNull();
  });

  it('encodes role names safely', () => {
    const link = priorityQueueLink({ role: 'print farm/a', priority_facet: null });
    expect(link).toContain(`role=${encodeURIComponent('print farm/a')}`);
  });
});
