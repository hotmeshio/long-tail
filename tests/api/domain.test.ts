import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../services/domain', () => ({
  getDomainDictionary: vi.fn(),
  putDomainDictionary: vi.fn(),
}));

import * as domainService from '../../services/domain';
import { getDomain, putDomain } from '../../api/domain';

const mockGet = vi.mocked(domainService.getDomainDictionary);
const mockPut = vi.mocked(domainService.putDomainDictionary);

const doc = { name: 'farm', version: '1', overview: 'o' } as any;

beforeEach(() => vi.clearAllMocks());

describe('api/domain', () => {
  it('GET returns the record, or { doc: null } when none is registered', async () => {
    mockGet.mockResolvedValue({ doc, version: 3, updated_at: 'now' });
    expect(await getDomain()).toEqual({ status: 200, data: { doc, version: 3, updated_at: 'now' } });

    mockGet.mockResolvedValue(null);
    expect(await getDomain()).toEqual({ status: 200, data: { doc: null } });
  });

  it('PUT 400s without a doc body', async () => {
    const result = await putDomain({} as any);
    expect(result.status).toBe(400);
    expect(mockPut).not.toHaveBeenCalled();
  });

  it('PUT passes doc + expected_version through and returns version + warnings', async () => {
    mockPut.mockResolvedValue({ ok: true, version: 4, warnings: ['facet "x" is not (yet) a known metadata facet'] });
    const result = await putDomain({ doc, expected_version: 3 });
    expect(mockPut).toHaveBeenCalledWith(doc, 3);
    expect(result).toEqual({ status: 200, data: { version: 4, warnings: ['facet "x" is not (yet) a known metadata facet'] } });
  });

  it('PUT 422s on hard reference errors, carrying errors + warnings', async () => {
    mockPut.mockResolvedValue({ ok: false, reason: 'invalid', errors: ['role "ghost" is not a live role'], warnings: [] });
    const result = await putDomain({ doc });
    expect(result.status).toBe(422);
    expect(result.data).toEqual({ errors: ['role "ghost" is not a live role'], warnings: [] });
  });

  it('PUT 409s on a version conflict', async () => {
    mockPut.mockResolvedValue({ ok: false, reason: 'version_conflict' });
    expect((await putDomain({ doc, expected_version: 1 })).status).toBe(409);
  });
});
