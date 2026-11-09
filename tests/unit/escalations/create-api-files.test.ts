import { describe, it, expect, vi, beforeEach } from 'vitest';

// A file ref grants every reader of the row a link to a storage object, so
// the HTTP create path takes builder authority to name one.

vi.mock('../../../services/escalation', () => ({ createEscalation: vi.fn() }));
vi.mock('../../../services/role', () => ({ getRoleMetadataSchema: vi.fn().mockResolvedValue(null) }));
vi.mock('../../../api/escalations/helpers', () => ({ assertQueueManageAccess: vi.fn() }));
vi.mock('../../../modules/capabilities', () => ({ mayBuild: vi.fn() }));

import * as svc from '../../../services/escalation';
import { assertQueueManageAccess } from '../../../api/escalations/helpers';
import { mayBuild } from '../../../modules/capabilities';
import { createEscalation } from '../../../api/escalations/create';

const mockCreate = vi.mocked(svc.createEscalation);
const mockBuild = vi.mocked(mayBuild);
const AUTH = { userId: 'user-1' };
const withFiles = (files: unknown) => JSON.stringify({ files });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(assertQueueManageAccess).mockResolvedValue(null as any);
  mockCreate.mockResolvedValue({ id: 'esc-1' } as any);
});

describe('createEscalation — file refs', () => {
  it('creates a row naming files for a builder', async () => {
    mockBuild.mockResolvedValue(true);
    const res = await createEscalation(
      { type: 'intake', role: 'verifier', envelope: withFiles([{ path: 'referrals/r-1.pdf', as: 'referral' }]) },
      AUTH,
    );
    expect(res.status).toBe(201);
    expect(mockCreate).toHaveBeenCalled();
  });

  it('refuses a queue manager without builder authority, and writes nothing', async () => {
    mockBuild.mockResolvedValue(false);
    const res = await createEscalation(
      { type: 'intake', role: 'verifier', envelope: withFiles([{ path: 'referrals/r-1.pdf', as: 'referral' }]) },
      AUTH,
    );
    expect(res.status).toBe(403);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('answers 400 for a malformed ref before any authority check', async () => {
    const res = await createEscalation(
      { type: 'intake', role: 'verifier', envelope: withFiles([{ path: '../secrets', as: 'x' }]) },
      AUTH,
    );
    expect(res.status).toBe(400);
    expect(res.error).toMatch(/storage key/);
    expect(mockBuild).not.toHaveBeenCalled();
  });

  it('asks nothing of a row without file refs', async () => {
    const res = await createEscalation({ type: 'intake', role: 'verifier', envelope: JSON.stringify({ note: 'x' }) }, AUTH);
    expect(res.status).toBe(201);
    expect(mockBuild).not.toHaveBeenCalled();
  });
});
