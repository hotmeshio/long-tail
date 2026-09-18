import { describe, it, expect } from 'vitest';
import {
  LIST_VIEWS,
  parseEscalationListUrl,
  readEscalationListParams,
  resolveListRoute,
  resolveListView,
  singleRoleOf,
} from '../escalation-list-url';

describe('parseEscalationListUrl', () => {
  it('reads every list param from a saved URL', () => {
    const p = parseEscalationListUrl(
      '/escalations/available?role=fleet&type=service&priority=2&search=sn&status=claimed&view=table'
      + '&facets=%7B%22region%22%3A%22nw%22%7D&jeopardy=1&orderBy=%5B%7B%22field%22%3A%22created_at%22%2C%22direction%22%3A%22asc%22%7D%5D',
    )!;
    expect(p.role).toBe('fleet');
    expect(p.type).toBe('service');
    expect(p.priority).toBe(2);
    expect(p.search).toBe('sn');
    expect(p.statusFilter).toBe('claimed');
    expect(p.view).toBe(LIST_VIEWS.TABLE);
    expect(p.facets.facets).toEqual({ region: 'nw' });
    expect(p.facets.jeopardy).toBe(true);
    expect(p.facets.orderBy).toEqual([{ field: 'created_at', direction: 'asc' }]);
  });

  it('the available pool defaults its status; the plain list leaves it unset', () => {
    expect(parseEscalationListUrl('/escalations/available?role=x')!.statusFilter).toBe('available');
    expect(parseEscalationListUrl('/escalations?role=x')!.statusFilter).toBe('');
    expect(parseEscalationListUrl('/escalations/available?role=x&status=all')!.statusFilter).toBe('all');
  });

  it('reads the layout hint and ignores an unknown one', () => {
    expect(parseEscalationListUrl('/escalations/available?view=table&layout=compact')!.layout).toBe('compact');
    expect(parseEscalationListUrl('/escalations/available?layout=cards')!.layout).toBe('cards');
    expect(parseEscalationListUrl('/escalations/available?layout=wide')!.layout).toBeNull();
    expect(parseEscalationListUrl('/escalations/available')!.layout).toBeNull();
  });

  it('ignores an unknown view and returns null for anything that is not a list', () => {
    expect(parseEscalationListUrl('/escalations/available?view=board')!.view).toBeNull();
    expect(parseEscalationListUrl('/escalations/detail/abc')).toBeNull();
    expect(parseEscalationListUrl('/operations')).toBeNull();
    expect(parseEscalationListUrl('http://[bad')).toBeNull();
  });

  it('readEscalationListParams takes a default status for an absent one', () => {
    expect(readEscalationListParams(new URLSearchParams('role=x'), 'available').statusFilter).toBe('available');
    expect(readEscalationListParams(new URLSearchParams('role=x&status=resolved'), 'available').statusFilter).toBe('resolved');
  });
});

describe('resolveListRoute', () => {
  it('routes each status as the list page does', () => {
    expect(resolveListRoute('available')).toEqual({ available: true, claimed: false, apiStatus: undefined });
    expect(resolveListRoute('claimed')).toEqual({ available: false, claimed: true, apiStatus: 'pending' });
    expect(resolveListRoute('resolved')).toEqual({ available: false, claimed: false, apiStatus: 'resolved' });
    expect(resolveListRoute('cancelled').apiStatus).toBe('cancelled');
    expect(resolveListRoute('expired').apiStatus).toBe('expired');
    expect(resolveListRoute('all')).toEqual({ available: false, claimed: false, apiStatus: undefined });
    expect(resolveListRoute('')).toEqual({ available: false, claimed: false, apiStatus: undefined });
  });
});

describe('singleRoleOf and resolveListView', () => {
  it('names the scoped role from the role param or a lone roles facet', () => {
    expect(singleRoleOf({ statusFilter: '', facets: {}, view: null, layout: null, role: 'a' })).toBe('a');
    expect(singleRoleOf({ statusFilter: '', facets: { roles: ['b'] }, view: null, layout: null })).toBe('b');
    expect(singleRoleOf({ statusFilter: '', facets: { roles: ['b', 'c'] }, view: null, layout: null })).toBeNull();
  });

  it('timeline when asked, rich when available and not refused, table otherwise', () => {
    expect(resolveListView(LIST_VIEWS.TIMELINE, true)).toBe(LIST_VIEWS.TIMELINE);
    expect(resolveListView(null, true)).toBe(LIST_VIEWS.RICH);
    expect(resolveListView(LIST_VIEWS.RICH, true)).toBe(LIST_VIEWS.RICH);
    expect(resolveListView(LIST_VIEWS.TABLE, true)).toBe(LIST_VIEWS.TABLE);
    expect(resolveListView(LIST_VIEWS.RICH, false)).toBe(LIST_VIEWS.TABLE);
    expect(resolveListView(null, false)).toBe(LIST_VIEWS.TABLE);
  });
});

describe('isPortalPath', () => {
  it('names the portal pages and nothing else', async () => {
    const { isPortalPath } = await import('../portal-path');
    expect(isPortalPath('/portal/printer-fleet')).toBe(true);
    expect(isPortalPath('/portal/printer-fleet/floor')).toBe(true);
    expect(isPortalPath('/portal')).toBe(true);
    expect(isPortalPath('/portals')).toBe(false);
    expect(isPortalPath('/escalations/available')).toBe(false);
  });
});
