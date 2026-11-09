import { describe, it, expect, vi, beforeEach } from 'vitest';

// The files endpoint: the refs on the row ARE the grant: readers of the
// escalation receive links to exactly the files it names, nothing else.

vi.mock('../../services/escalation', () => ({ getEscalation: vi.fn() }));
vi.mock('../../api/escalations/helpers', () => ({ assertReadAccess: vi.fn() }));
const getSignedUrl = vi.fn();
vi.mock('../../lib/storage', () => ({ getStorageBackend: () => ({ getSignedUrl }) }));

import { getEscalationFiles } from '../../api/escalations/files';
import * as escalationService from '../../services/escalation';
import { assertReadAccess } from '../../api/escalations/helpers';
import { config } from '../../modules/config';

const mockGet = vi.mocked(escalationService.getEscalation);
const mockRead = vi.mocked(assertReadAccess);
const AUTH = { userId: 'user-1' } as any;
const FILES = JSON.stringify({ files: [{ path: 'referrals/r-1.pdf', as: 'referral' }] });

beforeEach(() => {
  vi.clearAllMocks();
  getSignedUrl.mockImplementation(async (key: string, seconds: number) => `https://s3.test/${key}?ttl=${seconds}`);
});

describe('getEscalationFiles', () => {
  it('signs the named files for a permitted reader', async () => {
    mockGet.mockResolvedValue({ id: 'esc-1', role: 'intake', envelope: FILES, assigned_to: null, assigned_until: null } as any);
    mockRead.mockResolvedValue(null);
    const result = await getEscalationFiles({ id: 'esc-1' }, AUTH);
    expect(result.status).toBe(200);
    expect(result.data.files).toEqual([expect.objectContaining({
      as: 'referral',
      path: 'referrals/r-1.pdf',
      contentType: 'application/pdf',
      url: `https://s3.test/referrals/r-1.pdf?ttl=${config.LT_ESCALATION_FILE_URL_TTL_SECONDS}`,
    })]);
  });

  it('stretches the link to cover the reader\'s own claim', async () => {
    const until = new Date(Date.now() + 3600_000);
    mockGet.mockResolvedValue({ id: 'esc-1', role: 'intake', envelope: FILES, assigned_to: 'user-1', assigned_until: until } as any);
    mockRead.mockResolvedValue(null);
    await getEscalationFiles({ id: 'esc-1' }, AUTH);
    const seconds = getSignedUrl.mock.calls[0][1];
    expect(seconds).toBeGreaterThanOrEqual(3599);
    expect(seconds).toBeLessThanOrEqual(3600);
  });

  it('gives another person\'s claim no stretch', async () => {
    const until = new Date(Date.now() + 3600_000);
    mockGet.mockResolvedValue({ id: 'esc-1', role: 'intake', envelope: FILES, assigned_to: 'user-2', assigned_until: until } as any);
    mockRead.mockResolvedValue(null);
    await getEscalationFiles({ id: 'esc-1' }, AUTH);
    expect(getSignedUrl.mock.calls[0][1]).toBe(config.LT_ESCALATION_FILE_URL_TTL_SECONDS);
  });

  it('denies a reader outside the escalation\'s scope and signs nothing', async () => {
    mockGet.mockResolvedValue({ id: 'esc-1', role: 'other', envelope: FILES } as any);
    mockRead.mockResolvedValue({ status: 403, error: 'Not authorized to view this escalation' });
    const result = await getEscalationFiles({ id: 'esc-1' }, AUTH);
    expect(result.status).toBe(403);
    expect(getSignedUrl).not.toHaveBeenCalled();
  });

  it('404s an unknown escalation', async () => {
    mockGet.mockResolvedValue(null);
    expect((await getEscalationFiles({ id: 'ghost' }, AUTH)).status).toBe(404);
  });

  it('answers an empty list for rows without refs, signing nothing', async () => {
    mockGet.mockResolvedValue({ id: 'esc-1', role: 'r', envelope: JSON.stringify({ formDefaults: {} }) } as any);
    mockRead.mockResolvedValue(null);
    const result = await getEscalationFiles({ id: 'esc-1' }, AUTH);
    expect(result.data).toEqual({ files: [] });
    expect(getSignedUrl).not.toHaveBeenCalled();
  });
});
