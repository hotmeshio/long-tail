import { describe, it, expect } from 'vitest';
import { buildTableRows, foldColumnText, mergeAggregates, withOpenMembers } from '../group-rows';
import type { LTEscalationRecord } from '../../../../api/types';

const row = (id: string, metadata: Record<string, unknown>) =>
  ({ id, metadata, envelope: '{}', escalation_payload: null, resolver_payload: null }) as unknown as LTEscalationRecord;

const a1 = row('a1', { binKey: 'A', held: 2, shipBy: '2026-10-13T20:00:00Z' });
const a2 = row('a2', { binKey: 'A', held: 1, shipBy: '2026-10-13T18:00:00Z' });
const b1 = row('b1', { binKey: 'B', held: 5 });

describe('buildTableRows', () => {
  it('is one row per escalation when ungrouped', () => {
    expect(buildTableRows([a1, b1]).map((r) => r.key)).toEqual(['a1', 'b1']);
  });

  it('follows the page groups, keeping member order and singleton rows', () => {
    const rows = buildTableRows([a1, a2, b1], [{ key: 'A', ids: ['a1', 'a2'] }, { key: null, ids: ['b1'] }]);
    expect(rows.map((r) => [r.key, r.rows.map((x) => x.id), r.groupKey])).toEqual([
      ['group:A', ['a1', 'a2'], 'A'],
      ['b1', ['b1'], null],
    ]);
  });
});

describe('withOpenMembers', () => {
  it('follows an open group with its members, the last closing the block', () => {
    const rows = buildTableRows([a1, a2, b1], [{ key: 'A', ids: ['a1', 'a2'] }, { key: 'B', ids: ['b1'] }]);
    expect(withOpenMembers(rows, new Set()).map((r) => r.key)).toEqual(['group:A', 'group:B']);
    const open = withOpenMembers(rows, new Set(['group:A']));
    expect(open.map((r) => [r.key, r.depth ?? 0, !!r.lastChild])).toEqual([
      ['group:A', 0, false], ['group:A/a1', 1, false], ['group:A/a2', 1, true], ['group:B', 0, false],
    ]);
  });
});

describe('foldColumnText', () => {
  const col = (group?: any) => ({ label: 'x', value: '{{metadata.held}}', group });
  it('reads the lead row by default', () => {
    expect(foldColumnText(col(), [a1, a2])).toBe('2');
  });
  it('sums, counts, and takes numeric min and max', () => {
    expect(foldColumnText(col('sum'), [a1, a2])).toBe('3');
    expect(foldColumnText(col('count'), [a1, a2])).toBe('2');
    expect(foldColumnText(col('min'), [a1, a2])).toBe('1');
    expect(foldColumnText(col('max'), [a1, a2])).toBe('2');
  });
  it('lists distinct values in row order', () => {
    const lane = { label: 'Lane', value: '{{metadata.binKey}}', group: 'distinct' as const };
    expect(foldColumnText(lane, [a1, a2, b1])).toBe('A, B');
  });

  it('orders instants as text and skips empty values', () => {
    const shipBy = { label: 'Ship by', value: '{{metadata.shipBy}}', group: 'min' as const };
    expect(foldColumnText(shipBy, [a1, a2, b1])).toBe('2026-10-13T18:00:00Z');
  });
});

describe('mergeAggregates', () => {
  it('sums counts, splits, and hidden across members', () => {
    expect(mergeAggregates([
      { count: 2, splits: { standard: 2 } },
      { count: 2, splits: { standard: 1, express: 1 }, hidden: 1 },
      undefined,
    ])).toEqual({ count: 4, splits: { standard: 3, express: 1 }, hidden: 1 });
  });
  it('is unresolved only when every member is', () => {
    expect(mergeAggregates([{ count: 0, unresolved: true }])).toEqual({ count: 0, unresolved: true });
    expect(mergeAggregates([{ count: 0, unresolved: true }, { count: 3 }])).toEqual({ count: 3 });
    expect(mergeAggregates([undefined])).toBeUndefined();
  });
  it('folds a min or max across members, by number or by text', () => {
    expect(mergeAggregates([{ count: 1, value: 30 }, { count: 2, value: 4 }, { count: 0 }], 'min')).toEqual({ count: 3, value: 4 });
    expect(mergeAggregates([{ count: 1, value: '2026-10-22' }, { count: 1, value: '2026-11-01' }], 'max'))
      .toEqual({ count: 2, value: '2026-11-01' });
    expect(mergeAggregates([{ count: 0 }, { count: 0 }], 'min')).toEqual({ count: 0 });
  });
});
