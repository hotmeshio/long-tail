import { describe, it, expect } from 'vitest';
import {
  AnalyticsInputError,
  requireCleanFilter,
  requireFacetKey,
  resolveAsOf,
  resolveGroupBy,
  resolveLiveStatuses,
  resolvePage,
  resolveWindow,
  validateStates,
} from '../../../services/escalation/aggregate-validate';
import { config } from '../../../modules/config';

// Every rejection here is a fail-loud contract: a filter the caller believes
// is applied but isn't would silently change what an aggregate MEANS.

describe('requireCleanFilter', () => {
  it.each(['status', 'available', 'jeopardy'] as const)(
    'rejects liveness field %s — liveness derives from the interval',
    (field) => {
      expect(() => requireCleanFilter({ [field]: 'x' } as any)).toThrow(AnalyticsInputError);
    },
  );

  it.each(['orderBy', 'limit', 'offset'] as const)(
    'rejects row-paging field %s on the filter',
    (field) => {
      expect(() => requireCleanFilter({ [field]: 1 } as any)).toThrow(AnalyticsInputError);
    },
  );

  it('rejects entity combined with role/roles — two scoping mechanisms', () => {
    expect(() => requireCleanFilter({ entity: 'serialNumber', role: 'printer-fleet' })).toThrow(
      /two scoping mechanisms/,
    );
    expect(() => requireCleanFilter({ entity: 'serialNumber', roles: ['a'] })).toThrow(
      AnalyticsInputError,
    );
  });

  it('rejects malformed range and exists keys instead of dropping them', () => {
    expect(() => requireCleanFilter({ range: [{ facet: 'bad-key', op: '>', value: 1 }] } as any))
      .toThrow(AnalyticsInputError);
    expect(() => requireCleanFilter({ range: [{ facet: 'score', op: '!!', value: 1 }] } as any))
      .toThrow(/not one of/);
    expect(() => requireCleanFilter({ exists: ['metadata.key'] })).toThrow(AnalyticsInputError);
  });

  it('passes a clean filter through untouched', () => {
    const q = { roles: ['a'], facets: { model: 'h2s' }, exists: ['serialNumber'] };
    expect(requireCleanFilter(q)).toBe(q);
  });
});

describe('requireFacetKey / resolveLiveStatuses', () => {
  it.each(['has space', 'a.b', "x'y", ''])('rejects facet key %j', (key) => {
    expect(() => requireFacetKey(key, 'test')).toThrow(AnalyticsInputError);
  });

  it('accepts mixed-case keys (serialNumber is the canonical example)', () => {
    expect(requireFacetKey('serialNumber', 'test')).toBe('serialNumber');
  });

  it('defaults liveStatuses to pending and rejects unknown statuses', () => {
    expect(resolveLiveStatuses(undefined)).toEqual(['pending']);
    expect(() => resolveLiveStatuses(['open'])).toThrow(/unknown status/);
    expect(() => resolveLiveStatuses([])).toThrow(AnalyticsInputError);
  });

  it('dedupes while preserving order — statuses become inline SQL literals', () => {
    expect(resolveLiveStatuses(['pending', 'resolved', 'pending'])).toEqual(['pending', 'resolved']);
  });
});

describe('resolveWindow / resolveAsOf', () => {
  it('rejects an empty or inverted window', () => {
    const t = new Date().toISOString();
    expect(() => resolveWindow({ from: t, to: t })).toThrow(/empty/);
  });

  it('rejects unparseable instants', () => {
    expect(() => resolveWindow({ from: 'yesterday-ish', to: new Date() })).toThrow(/parseable/);
  });

  it('caps the window span at LT_ANALYTICS_MAX_WINDOW_DAYS', () => {
    const to = new Date();
    const from = new Date(to.getTime() - (config.LT_ANALYTICS_MAX_WINDOW_DAYS + 1) * 86_400_000);
    expect(() => resolveWindow({ from, to })).toThrow(/LT_ANALYTICS_MAX_WINDOW_DAYS/);
  });

  it('classifies the anchor: to >= now is now-anchored, fully past is not', () => {
    const now = Date.now();
    expect(resolveWindow({ from: new Date(now - 3_600_000), to: new Date(now + 60_000) })?.nowAnchored).toBe(true);
    expect(resolveWindow({ from: new Date(now - 7_200_000), to: new Date(now - 3_600_000) })?.nowAnchored).toBe(false);
  });

  it('asOf omitted = now (null); a future asOf is rejected', () => {
    expect(resolveAsOf(undefined)).toBeNull();
    expect(() => resolveAsOf(new Date(Date.now() + 60_000))).toThrow(/future/);
    expect(resolveAsOf(new Date(Date.now() - 60_000))).toBeInstanceOf(Date);
  });
});

describe('resolveGroupBy / validateStates / resolvePage', () => {
  it('rejects non-whitelisted columns and malformed facet keys', () => {
    expect(() => resolveGroupBy({ columns: ['priority' as any] })).toThrow(/groupBy.columns/);
    expect(() => resolveGroupBy({ facets: ['bad key'] })).toThrow(AnalyticsInputError);
  });

  it('dedupes columns and facets', () => {
    expect(resolveGroupBy({ columns: ['role', 'role'], facets: ['model', 'model'] })).toEqual({
      columns: ['role'],
      facets: ['model'],
      state: false,
    });
  });

  it('rejects a state label matching a key the query never produces', () => {
    expect(() =>
      validateStates([{ name: 'printing', match: { subtype: 'printing' } }], ['role'], []),
    ).toThrow(/does not include "subtype"/);
    expect(() =>
      validateStates([{ name: 'x', match: { facets: { model: 'h2s' } } }], [], []),
    ).toThrow(/does not include it/);
  });

  it('caps the page at LT_ANALYTICS_MAX_GROUPS and rejects bad paging', () => {
    expect(resolvePage(undefined, undefined).pageLimit).toBe(config.LT_ANALYTICS_MAX_GROUPS);
    expect(resolvePage(config.LT_ANALYTICS_MAX_GROUPS * 2, 0).pageLimit).toBe(config.LT_ANALYTICS_MAX_GROUPS);
    expect(() => resolvePage(0)).toThrow(/positive integer/);
    expect(() => resolvePage(10, -1)).toThrow(/non-negative/);
  });
});
