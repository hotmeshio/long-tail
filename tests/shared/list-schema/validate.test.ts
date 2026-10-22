import { describe, it, expect } from 'vitest';

import { listSchemaRelationsError, readListSchemaRelations } from '../../../shared/list-schema';

const valid = {
  'x-lt-layout': 'facet-table',
  'x-lt-related': {
    contents: { source: 'items' },
    coming: { source: 'query', query: { roles: ['prep', 'check'], facets: { destination: '{{metadata.destination}}' } } },
  },
  'x-lt-columns': [
    { label: 'Bin', value: '{{metadata.binKey}}' },
    { label: 'Holds', related: 'contents', aggregate: 'count', splitBy: 'reciprocal.metadata.serviceLevel' },
    { label: 'Coming', related: 'coming', splitBy: 'role' },
  ],
  'x-lt-row-detail': [{ related: 'contents', columns: [{ label: 'Item', value: '{{item.itemKey}}' }] }],
  'x-lt-group-by': 'metadata.binKey',
};

const withSet = (set: unknown) => ({ 'x-lt-related': { s: set } });
const withColumn = (col: unknown) => ({ 'x-lt-related': { s: { source: 'items' } }, 'x-lt-columns': [col] });

describe('readListSchemaRelations', () => {
  it('normalizes a full declaration', () => {
    const r = readListSchemaRelations(valid);
    expect(Object.keys(r.sets)).toEqual(['contents', 'coming']);
    expect(r.sets.coming.query).toEqual({ roles: ['prep', 'check'], facets: { destination: '{{metadata.destination}}' } });
    expect(r.columns.map((c) => c.related)).toEqual(['contents', 'coming']);
    expect(r.rowDetail).toHaveLength(1);
    expect(r.groupKey).toBe('binKey');
  });

  it('leaves schemas without the vocabulary untouched', () => {
    expect(readListSchemaRelations({ 'x-lt-layout': 'facet-board', 'x-lt-group-by': 'envelope.x' }))
      .toEqual({ sets: {}, columns: [], rowDetail: [], groupKey: null });
    expect(readListSchemaRelations(null).sets).toEqual({});
  });

  it('keeps narrow facets beside the required ones', () => {
    expect(readListSchemaRelations(withSet({ source: 'query', query: { roles: ['a'], facets: { d: 1 }, narrow: { lane: '{{metadata.lane}}' } } })).sets.s.query)
      .toEqual({ roles: ['a'], facets: { d: 1 }, narrow: { lane: '{{metadata.lane}}' } });
  });

  it('accepts a segment in place of roles', () => {
    expect(readListSchemaRelations(withSet({ source: 'query', query: { segment: 'prep', facets: { d: 1 } } })).sets.s.query)
      .toEqual({ segment: 'prep', facets: { d: 1 } });
  });
});

describe('listSchemaRelationsError', () => {
  it.each([
    ['unknown source', withSet({ source: 'rows' }), /source must be/],
    ['items with a query', withSet({ source: 'items', query: {} }), /takes no query/],
    ['query without query', withSet({ source: 'query' }), /query is required/],
    ['roles and segment', withSet({ source: 'query', query: { roles: ['a'], segment: 'a', facets: { d: 1 } } }), /exactly one/],
    ['empty roles', withSet({ source: 'query', query: { roles: [], facets: { d: 1 } } }), /roles must be/],
    ['no facets', withSet({ source: 'query', query: { roles: ['a'] } }), /at least one facet/],
    ['bad facet key', withSet({ source: 'query', query: { roles: ['a'], facets: { 'a.b': 1 } } }), /letters, digits/],
    ['empty narrow', withSet({ source: 'query', query: { roles: ['a'], facets: { d: 1 }, narrow: {} } }), /narrow must name/],
    ['narrow repeats a facet', withSet({ source: 'query', query: { roles: ['a'], facets: { d: 1 }, narrow: { d: 2 } } }), /already a required facet/],
    ['bad narrow key', withSet({ source: 'query', query: { roles: ['a'], facets: { d: 1 }, narrow: { 'x.y': 1 } } }), /narrow key/],
    ['object facet value', withSet({ source: 'query', query: { roles: ['a'], facets: { d: { x: 1 } } } }), /scalar/],
    ['bad set name', { 'x-lt-related': { '1x': { source: 'items' } } }, /must start with a letter/],
    ['empty related', { 'x-lt-related': {} }, /1\.\.4 sets/],
    ['unknown column set', withColumn({ label: 'x', related: 'nope' }), /must name a set/],
    ['bad aggregate', withColumn({ label: 'x', related: 's', aggregate: 'sum' }), /aggregate must be/],
    ['items role split', withColumn({ label: 'x', related: 's', splitBy: 'role' }), /items set must be/],
    ['bad labels', withColumn({ label: 'x', related: 's', labels: { a: 1 } }), /labels must map/],
    ['bad group fold', { 'x-lt-columns': [{ label: 'x', value: 'y', group: 'avg' }] }, /group must be one of/],
    ['row detail unknown set', { 'x-lt-row-detail': [{ related: 'x', columns: [{ label: 'a', value: 'b' }] }] }, /must name a set/],
    ['row detail no columns', { 'x-lt-related': { s: { source: 'items' } }, 'x-lt-row-detail': [{ related: 's', columns: [] }] }, /at least one column/],
    ['row detail limit', { 'x-lt-related': { s: { source: 'items' } }, 'x-lt-row-detail': [{ related: 's', limit: 500, columns: [{ label: 'a', value: 'b' }] }] }, /limit must be/],
    ['table group path', { 'x-lt-layout': 'facet-table', 'x-lt-group-by': 'envelope.bin' }, /metadata.<key>/],
  ])('rejects %s', (_name, schema, message) => {
    expect(listSchemaRelationsError(schema)).toMatch(message);
  });

  it('accepts the valid declaration', () => {
    expect(listSchemaRelationsError(valid)).toBeNull();
  });
});

describe('related column aggregates', () => {
  const querySet = (col: unknown) => ({
    'x-lt-related': { s: { source: 'query', query: { roles: ['prep'], facets: { d: '{{metadata.d}}' } } } },
    'x-lt-columns': [col],
  });

  it('accepts min and max over a value that fits the set', () => {
    expect(listSchemaRelationsError(withColumn({ label: 'Earliest', related: 's', aggregate: 'min', value: '{{item.payload.commitBy}}', format: 'date' }))).toBeNull();
    expect(listSchemaRelationsError(querySet({ label: 'Latest', related: 's', aggregate: 'max', value: '{{metadata.due}}' }))).toBeNull();
  });

  it('refuses a min or max whose value does not fit, or that splits or displays', () => {
    expect(listSchemaRelationsError(withColumn({ label: 'E', related: 's', aggregate: 'min', value: '{{metadata.due}}' })))
      .toMatch(/value must be "\{\{item.payload.<path>\}\}"/);
    expect(listSchemaRelationsError(querySet({ label: 'E', related: 's', aggregate: 'min' }))).toMatch(/metadata.<key>/);
    expect(listSchemaRelationsError(withColumn({ label: 'E', related: 's', aggregate: 'max', value: '{{item.payload.a}}', splitBy: 'payload.b' })))
      .toMatch(/takes no splitBy/);
    expect(listSchemaRelationsError(withColumn({ label: 'E', related: 's', aggregate: 'max', value: '{{item.payload.a}}', display: { '0': 'x' } })))
      .toMatch(/display applies to a count column/);
    expect(listSchemaRelationsError(withColumn({ label: 'E', related: 's', value: '{{item.payload.a}}' }))).toMatch(/applies to a min or max/);
    expect(listSchemaRelationsError(withColumn({ label: 'E', related: 's', aggregate: 'avg' }))).toMatch(/"count", "min" or "max"/);
  });

  it('accepts a count display keyed by count or default, and nothing else', () => {
    expect(listSchemaRelationsError(withColumn({ label: 'C', related: 's', display: { '0': 'Ready', default: 'Waiting on {n}' } }))).toBeNull();
    expect(listSchemaRelationsError(withColumn({ label: 'C', related: 's', display: { '01': 'x' } }))).toMatch(/display must map counts/);
    expect(listSchemaRelationsError(withColumn({ label: 'C', related: 's', display: { many: 'x' } }))).toMatch(/display must map counts/);
    expect(listSchemaRelationsError(withColumn({ label: 'C', related: 's', display: { '0': 1 } }))).toMatch(/display must map counts/);
    expect(listSchemaRelationsError(withColumn({ label: 'C', related: 's', display: {} }))).toMatch(/display must map counts/);
  });
});
