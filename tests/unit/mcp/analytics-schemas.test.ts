import { describe, it, expect } from 'vitest';
import {
  aggregateByFacetsSchema,
  timelineByFacetSchema,
} from '../../../system/mcp-servers/admin/schemas';

// The MCP tools are schema-described for agent use: the zod schemas are the
// contract an agent plans against, so their shape (not just their presence)
// is the unit under test.

describe('aggregateByFacetsSchema', () => {
  it('accepts the canonical Q1 one-liner', () => {
    const parsed = aggregateByFacetsSchema.safeParse({
      query: { entity: 'serialNumber' },
      groupBy: { state: true },
      measure: { kind: 'dwell', window: { from: '2026-08-01T00:00:00Z', to: '2026-08-01T12:00:00Z' } },
    });
    expect(parsed.success).toBe(true);
  });

  it('accepts membership with asOf and distinctBy', () => {
    const parsed = aggregateByFacetsSchema.safeParse({
      query: { roles: ['printer-fleet'] },
      groupBy: { columns: ['role', 'subtype'], facets: ['model'] },
      measure: { kind: 'membership', asOf: '2026-08-01T09:00:00Z' },
      distinctBy: 'serialNumber',
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects unknown measure kinds and non-whitelisted group columns', () => {
    expect(
      aggregateByFacetsSchema.safeParse({
        query: {},
        groupBy: {},
        measure: { kind: 'average' },
      }).success,
    ).toBe(false);
    expect(
      aggregateByFacetsSchema.safeParse({
        query: {},
        groupBy: { columns: ['priority'] },
        measure: { kind: 'membership' },
      }).success,
    ).toBe(false);
  });
});

describe('timelineByFacetSchema', () => {
  it('requires the facet pair and accepts window/select', () => {
    expect(timelineByFacetSchema.safeParse({}).success).toBe(false);
    expect(
      timelineByFacetSchema.safeParse({
        facet: { key: 'serialNumber', value: 'SN-1' },
        window: { from: '2026-08-01T00:00:00Z', to: '2026-08-01T12:00:00Z' },
        select: { columns: ['role', 'subtype'], facets: ['model'] },
      }).success,
    ).toBe(true);
  });
});
