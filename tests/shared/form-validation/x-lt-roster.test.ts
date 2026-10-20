import { describe, it, expect } from 'vitest';

import {
  computeRoster,
  readRosterDef,
  readRosterDefs,
  resolveRosterQuery,
  rosterHeadline,
  rosterRowContext,
  ROSTER_QUERY_LIMIT,
  type RosterDef,
} from '../../../shared/form-validation/x-lt-roster';
import { evaluateShowIf } from '../../../shared/form-validation/x-lt-show-if';

const member = (id: string, orderId: string, extra: Record<string, unknown> = {}) =>
  rosterRowContext({ id, status: 'pending', metadata: { orderId }, resolver_payload: null, ...extra });

const QUERY_DEF: RosterDef = {
  expected: { query: { roles: ['packing'], facets: { box: '{{escalation.id}}' } } },
  key: '{{metadata.orderId}}',
  in: ['items', 'resolver.bags'],
  flagged: [{ when: 'resolver.outcome=missing', label: 'Missing' }],
};

describe('readRosterDef', () => {
  it('reads a declaration with one expected source', () => {
    expect(readRosterDef({ 'x-lt-roster': { expected: { list: 'metadata.members' } } })).toBeDefined();
    expect(readRosterDef({ 'x-lt-roster': { expected: { batch: true } } })).toBeDefined();
  });

  it('ignores a declaration with no usable source', () => {
    expect(readRosterDef({ 'x-lt-roster': { expected: {} } })).toBeUndefined();
    expect(readRosterDef({ 'x-lt-roster': 'orders' })).toBeUndefined();
    expect(readRosterDef({})).toBeUndefined();
  });

  it('collects every roster field of a schema by name', () => {
    const defs = readRosterDefs({ properties: { orders: { 'x-lt-roster': QUERY_DEF }, weight: { type: 'number' } } });
    expect(Object.keys(defs)).toEqual(['orders']);
  });
});

describe('resolveRosterQuery', () => {
  it('interpolates facets, merges role and roles, reads every status by default, caps the rows', () => {
    const q = resolveRosterQuery({ role: 'a', roles: ['b'], facets: { box: '{{escalation.id}}' } }, { escalation: { id: 'box-1' } });
    expect(q).toEqual({ roles: ['a', 'b'], facets: { box: 'box-1' }, limit: ROSTER_QUERY_LIMIT });
  });

  it('keeps a named status and drops any', () => {
    expect(resolveRosterQuery({ role: 'a', status: 'pending' }, {})?.status).toBe('pending');
    expect(resolveRosterQuery({ role: 'a', status: 'any' }, {})?.status).toBeUndefined();
  });

  it('runs no query when a facet does not resolve or the scope is empty', () => {
    expect(resolveRosterQuery({ role: 'a', facets: { box: '{{metadata.missing}}' } }, { metadata: {} })).toBeNull();
    expect(resolveRosterQuery({}, {})).toBeNull();
  });
});

describe('computeRoster', () => {
  const host = (extra: Record<string, unknown> = {}) => ({
    escalation: { id: 'box-1' },
    metadata: { accumulate_keys: ['o-1'] },
    resolver: { bags: ['o-2'] },
    ...extra,
  });

  it('marks held and scanned members in, flagged members flagged, the rest waiting', () => {
    const rows = [
      member('m1', 'o-1'),
      member('m2', 'o-2'),
      member('m3', 'o-3', { status: 'resolved', resolver_payload: JSON.stringify({ outcome: 'missing' }) }),
      member('m4', 'o-4'),
    ];
    const result = computeRoster(QUERY_DEF, host(), rows);
    expect(result.entries.map((e) => [e.key, e.state])).toEqual([
      ['o-1', 'in'], ['o-2', 'in'], ['o-3', 'flagged'], ['o-4', 'waiting'],
    ]);
    expect(result.entries[2].flag).toBe('Missing');
    expect(result.counts).toEqual({ expected: 4, in: 2, flagged: 1, waiting: 1, outstanding: 1 });
    expect(rosterHeadline(result)).toBe('2 of 4 in · 1 Missing');
  });

  it('reads in over flagged, so a flagged member added to the container counts in', () => {
    const rows = [member('m1', 'o-1', { resolver_payload: { outcome: 'missing' } })];
    expect(computeRoster(QUERY_DEF, host(), rows).entries[0].state).toBe('in');
  });

  it('reads each key once and skips rows whose key does not resolve', () => {
    const rows = [member('m1', 'o-9'), member('m2', 'o-9'), rosterRowContext({ id: 'm3', metadata: {} })];
    expect(computeRoster(QUERY_DEF, host(), rows).entries.map((e) => e.key)).toEqual(['o-9']);
  });

  it('reads the newest of several rows sharing a key, so state and actions follow the live row', () => {
    const older = member('m-old', 'o-7', { status: 'resolved', created_at: '2026-10-20T10:00:00Z', resolver_payload: { outcome: 'missing' } });
    const newer = member('m-new', 'o-7', { created_at: '2026-10-20T11:00:00Z' });
    for (const rows of [[older, newer], [newer, older]]) {
      const [entry] = computeRoster(QUERY_DEF, host(), rows).entries;
      expect(entry.state).toBe('waiting');
      expect(entry.row?.escalation.id).toBe('m-new');
    }
  });

  it('defaults the key to the member row id and the in source to the held items', () => {
    const def: RosterDef = { expected: { query: { role: 'packing' } } };
    const result = computeRoster(def, { metadata: { accumulate_keys: ['m1'] } }, [member('m1', 'x'), member('m2', 'y')]);
    expect(result.entries.map((e) => [e.key, e.state])).toEqual([['m1', 'in'], ['m2', 'waiting']]);
  });

  it('expects a list named on the host row, with accumulated items read from the envelope too', () => {
    const def: RosterDef = { expected: { list: 'metadata.members' } };
    const ctx = { metadata: { members: ['a', 'b'] }, envelope: { accumulate_items: { a: { at: 't' } } } };
    expect(computeRoster(def, ctx).counts).toMatchObject({ expected: 2, in: 1, outstanding: 1 });
  });

  it('expects a batch’s keys, filled keys in, with labels from the named map', () => {
    const def: RosterDef = { expected: { batch: true, labels: 'envelope.labels' } };
    const ctx = {
      metadata: { batch_keys: ['k1', 'k2'], batch_pending: ['k2'] },
      envelope: { labels: { k1: { model: 'A' }, k2: { model: 'B' } } },
    };
    const result = computeRoster(def, ctx);
    expect(result.entries.map((e) => [e.key, e.state, e.label])).toEqual([
      ['k1', 'in', { model: 'A' }], ['k2', 'waiting', { model: 'B' }],
    ]);
  });

  it('accepts a single string as an in source', () => {
    const def: RosterDef = { expected: { list: 'metadata.members' }, in: ['resolver.bag'] };
    expect(computeRoster(def, { metadata: { members: ['a'] }, resolver: { bag: 'a' } }).counts.in).toBe(1);
  });

  it('skips a flag rule with no condition or label', () => {
    const def: RosterDef = { ...QUERY_DEF, flagged: [{ when: '', label: 'Never' }, { when: 'resolver.outcome', label: 1 as any }] };
    const rows = [member('m1', 'o-5', { resolver_payload: { outcome: 'x' } })];
    expect(computeRoster(def, host(), rows).entries[0].state).toBe('waiting');
  });

  it('feeds showIf through the roster domain', () => {
    const result = computeRoster(QUERY_DEF, host(), [member('m1', 'o-1')]);
    const ctx = { roster: { orders: result.counts } };
    expect(evaluateShowIf('roster.orders.outstanding=0', ctx)).toBe(true);
    expect(evaluateShowIf('roster.orders.outstanding=0', {})).toBe(false);
  });
});
