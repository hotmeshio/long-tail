import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

import type { EscalationFilters } from '../../api/escalations';
import type { FacetFilters } from '../../api/escalations';
import { LIST_FILTER_KEYS, parseEscalationListUrl, type ListFilterKey } from '../escalation-list-url';
import { pinBadgeQuery } from '../pinned-views';

const sent = vi.hoisted(() => ({ list: [] as Record<string, unknown>[] }));
vi.mock('../../api/escalations', () => ({
  useAvailableEscalations: (f: Record<string, unknown>) => { sent.list.push(f); return { data: undefined }; },
  useEscalations: (f: Record<string, unknown>) => { sent.list.push(f); return { data: undefined }; },
}));
vi.mock('../../api/roles', () => ({ useRoleListSchema: () => ({ data: undefined, isFetched: true }) }));

import { useEscalationListQuery } from '../../hooks/useEscalationListQuery';

// Every scalar filter the list API client accepts is either a list URL filter
// or named here as carried another way. A new API filter fails to typecheck
// until it is placed, so a pin or a list can never silently drop it.
type CarriedElsewhere =
  | 'status' | 'claimed' | 'assigned_to' | 'parent_id'
  | 'limit' | 'offset' | 'sort_by' | 'order' | 'enabled' | 'staleTime';
type Unplaced = Exclude<keyof EscalationFilters, ListFilterKey | CarriedElsewhere | keyof FacetFilters>;
const everyFilterPlaced: [Unplaced] extends [never] ? true : false = true;

const VALUES: Record<ListFilterKey, string> = {
  role: 'fleet', type: 'bag', subtype: 'slot', priority: '2', search: 'sn',
};
const expected = (key: ListFilterKey) => (key === 'priority' ? 2 : VALUES[key]);
const url = `/escalations/available?${new URLSearchParams(VALUES)}`;

describe('list filter parity', () => {
  it('every API list filter is placed', () => {
    expect(everyFilterPlaced).toBe(true);
  });

  it.each(LIST_FILTER_KEYS)('the list URL reader keeps %s', (key) => {
    expect(parseEscalationListUrl(url)![key]).toBe(expected(key));
  });

  it.each(LIST_FILTER_KEYS)('the pin badge query forwards %s', (key) => {
    expect(pinBadgeQuery(url)!.params[key]).toBe(expected(key));
  });

  it.each(LIST_FILTER_KEYS)('the list query forwards %s', (key) => {
    sent.list = [];
    renderHook(() => useEscalationListQuery(parseEscalationListUrl(url)!, { limit: 25, offset: 0 }));
    expect(sent.list.every((f) => f[key] === expected(key))).toBe(true);
  });

  it('two pins that differ only by subtype send different queries', () => {
    const a = pinBadgeQuery('/escalations/available?role=fleet&subtype=box')!;
    const b = pinBadgeQuery('/escalations/available?role=fleet&subtype=slot')!;
    expect(a.params).not.toEqual(b.params);
  });
});
