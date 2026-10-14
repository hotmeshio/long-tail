import { describe, it, expect } from 'vitest';

import { listSchemaRelationsError, readListSchemaRelations } from '../../shared/list-schema';
import { CONSOLIDATE_LIST_SCHEMA, STATION_LIST_SCHEMA } from '../../examples/workflows/consolidation/schemas';
import { CONSOLIDATION_ROLES } from '../../examples/workflows/consolidation';

describe('consolidation example list schemas', () => {
  it('declare a valid container view', () => {
    expect(listSchemaRelationsError(CONSOLIDATE_LIST_SCHEMA)).toBeNull();
    expect(listSchemaRelationsError(STATION_LIST_SCHEMA)).toBeNull();
  });

  it('read the contents and look ahead along the order segment, grouped by tub', () => {
    const relations = readListSchemaRelations(CONSOLIDATE_LIST_SCHEMA);
    expect(relations.sets.contents).toEqual({ source: 'items' });
    expect(relations.sets.coming.query).toEqual({
      segment: CONSOLIDATION_ROLES.PREP,
      facets: { destination: '{{metadata.destination}}' },
      narrow: { serviceLevel: '{{metadata.lane}}' },
    });
    expect(relations.groupKey).toBe('binKey');
    expect(relations.rowDetail.map((s) => s.related)).toEqual(['contents', 'coming']);
  });
});
