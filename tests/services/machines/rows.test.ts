import { describe, it, expect } from 'vitest';

import { readHandoffFacets, standardRows } from '../../../services/machines/rows';
import { ROW_TYPE } from '../../../services/machines/contracts';
import { facetsFor } from '../../helpers/machine-line-gateway-harness';

const FILE = { url: 'https://files/U1.step', sha256: 'ab'.repeat(32) };

describe('readHandoffFacets', () => {
  it('reads the standard facets of a handoff row', () => {
    const facets = facetsFor(['U1', 'U2'], 'press-01', 'cut-01');
    expect(readHandoffFacets(facets as unknown as Record<string, any>)).toEqual(facets);
  });

  it('keeps the job\'s parameters, and each unit\'s own artifact and parameters', () => {
    const md = {
      ...facetsFor(['U1', 'U2'], null, 'press-01'),
      parameters: { dwellS: 6, profile: 'A' },
      units: [{ unitId: 'U1', carrierId: 'CR-U1', artifact: FILE, parameters: { trimPath: 'p-1' } }, { unitId: 'U2', carrierId: null }],
    };
    expect(readHandoffFacets(md)).toMatchObject({
      parameters: { dwellS: 6, profile: 'A' },
      units: [{ unitId: 'U1', carrierId: 'CR-U1', artifact: FILE, parameters: { trimPath: 'p-1' } }, { unitId: 'U2', carrierId: null }],
    });
    expect(readHandoffFacets(md)!.units[1]).toEqual({ unitId: 'U2', carrierId: null });
  });

  it('drops parameters that are not an object and an artifact without both url and sha256', () => {
    const md = {
      ...facetsFor('U1', null, 'press-01'),
      parameters: ['not', 'an', 'object'],
      units: [{ unitId: 'U1', carrierId: null, artifact: { url: FILE.url }, parameters: 'p-1' }],
    };
    const facets = readHandoffFacets(md)!;
    expect(facets).not.toHaveProperty('parameters');
    expect(facets.units).toEqual([{ unitId: 'U1', carrierId: null }]);
  });

  it('is null without the line, the job or any unit', () => {
    const md = facetsFor('U1', null, 'press-01') as unknown as Record<string, any>;
    for (const key of ['siteId', 'lineId', 'jobId']) expect(readHandoffFacets({ ...md, [key]: undefined })).toBeNull();
    expect(readHandoffFacets({ ...md, units: [] })).toBeNull();
  });
});

describe('standardRows', () => {
  it('reads handoff rows and nothing else, and reads them back by type when a gateway takes the line', () => {
    const metadata = facetsFor('U1', null, 'press-01') as unknown as Record<string, any>;
    expect(standardRows.toHandoff({ id: 'r1', role: 'line-bond', type: ROW_TYPE.HANDOFF, metadata })).toMatchObject({ jobId: 'U1-press-01' });
    expect(standardRows.toHandoff({ id: 'r2', role: 'line-bond', type: ROW_TYPE.ALARM, metadata })).toBeNull();
    expect(standardRows.openRows({} as any)).toEqual([{ type: ROW_TYPE.HANDOFF }]);
  });
});
