import { describe, it, expect } from 'vitest';
import { jeopardyQueueLink } from '../priority-link';

describe('jeopardyQueueLink', () => {
  it('reproduces the pill exactly: jeopardy filter, table view, facet-ascending sort', () => {
    const link = jeopardyQueueLink({ role: 'gluer', priority_facet: 'authorized_at' });
    const url = new URL(link, 'http://localhost');
    expect(url.pathname).toBe('/escalations/available');
    expect(url.searchParams.get('role')).toBe('gluer');
    // The server-side threshold predicate — list total equals the pill's count
    expect(url.searchParams.get('jeopardy')).toBe('1');
    // A discrete, countable list — never the timeline
    expect(url.searchParams.get('view')).toBe('table');
    expect(JSON.parse(url.searchParams.get('orderBy')!)).toEqual([
      { field: 'metadata.authorized_at', direction: 'asc' },
    ]);
  });

  it('sorts by created_at ascending when no facet is configured — same orderBy grammar', () => {
    const link = jeopardyQueueLink({ role: 'gluer', priority_facet: null });
    const url = new URL(link, 'http://localhost');
    expect(url.searchParams.get('jeopardy')).toBe('1');
    expect(url.searchParams.get('view')).toBe('table');
    expect(JSON.parse(url.searchParams.get('orderBy')!)).toEqual([
      { field: 'created_at', direction: 'asc' },
    ]);
    // The legacy sort_by/order pair is retired — orderBy is the one sort grammar
    expect(url.searchParams.get('sort_by')).toBeNull();
    expect(url.searchParams.get('order')).toBeNull();
  });

  it('encodes role names safely', () => {
    const link = jeopardyQueueLink({ role: 'print farm/a', priority_facet: null });
    expect(link).toContain(`role=${encodeURIComponent('print farm/a')}`);
  });
});
