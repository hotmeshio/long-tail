import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../services/escalation', () => ({
  createEscalation: vi.fn(),
  createEscalationOnce: vi.fn(),
}));

vi.mock('../../../services/role', () => ({
  getRoleMetadataSchema: vi.fn(),
}));

vi.mock('../../../api/escalations/helpers', () => ({
  assertQueueManageAccess: vi.fn(),
}));

import * as svc from '../../../services/escalation';
import * as roleService from '../../../services/role';
import { assertQueueManageAccess } from '../../../api/escalations/helpers';
import { createEscalation } from '../../../api/escalations/create';

const mockCreate = vi.mocked(svc.createEscalation);
const mockOnce = vi.mocked(svc.createEscalationOnce);
const AUTH = { userId: 'user-1' };
const KEY = 'machine-request:s1:l1:press-01:m-7';

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(assertQueueManageAccess).mockResolvedValue(null as any);
  vi.mocked(roleService.getRoleMetadataSchema).mockResolvedValue(null);
});

describe('createEscalation with signal_key', () => {
  it('creates the row once: 201 with the new row', async () => {
    mockOnce.mockResolvedValue({ escalation: { id: 'esc-1', role: 'grind' } as any, created: true });
    const res = await createEscalation({ type: 'order', role: 'grind', signal_key: KEY }, AUTH);
    expect(res).toMatchObject({ status: 201, data: { id: 'esc-1' } });
    expect(mockOnce).toHaveBeenCalledWith(expect.objectContaining({ type: 'order', role: 'grind' }), KEY);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('a repeat returns the row that holds the key: 200', async () => {
    mockOnce.mockResolvedValue({ escalation: { id: 'esc-1', role: 'grind', status: 'resolved' } as any, created: false });
    const res = await createEscalation({ type: 'order', role: 'grind', signal_key: KEY }, AUTH);
    expect(res).toMatchObject({ status: 200, data: { id: 'esc-1', status: 'resolved' } });
  });

  it('a key held by a row on another role answers 409 and returns nothing of it', async () => {
    mockOnce.mockResolvedValue({ escalation: { id: 'esc-9', role: 'secret' } as any, created: false });
    const res = await createEscalation({ type: 'order', role: 'grind', signal_key: KEY }, AUTH);
    expect(res.status).toBe(409);
    expect(res.data).toBeUndefined();
    expect(res.error).not.toContain('esc-9');
  });

  it('refuses an empty, non-string or overlong key before anything is created', async () => {
    for (const signal_key of ['', 42 as any, 'k'.repeat(256)]) {
      const res = await createEscalation({ type: 'order', role: 'grind', signal_key }, AUTH);
      expect(res.status).toBe(400);
    }
    expect(mockOnce).not.toHaveBeenCalled();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('without a key, creation is unchanged', async () => {
    mockCreate.mockResolvedValue({ id: 'esc-2' } as any);
    const res = await createEscalation({ type: 'order', role: 'grind' }, AUTH);
    expect(res).toMatchObject({ status: 201, data: { id: 'esc-2' } });
    expect(mockOnce).not.toHaveBeenCalled();
  });

  it('a role the caller may not write is refused before the key is looked at', async () => {
    vi.mocked(assertQueueManageAccess).mockResolvedValue('denied' as any);
    const res = await createEscalation({ type: 'order', role: 'grind', signal_key: KEY }, AUTH);
    expect(res.status).toBe(403);
    expect(mockOnce).not.toHaveBeenCalled();
  });

  it('an accumulate declaration opens the row as an accumulator; a malformed one is refused', async () => {
    mockCreate.mockResolvedValue({ id: 'esc-3' } as any);
    const ok = await createEscalation({ type: 'order', role: 'grind', accumulate: {} }, AUTH);
    expect(ok.status).toBe(201);
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ accumulate: {} }));
    for (const accumulate of [[], { max: 0 }, { unique: 'yes' }, { limit: 3 }] as any[]) {
      expect((await createEscalation({ type: 'order', role: 'grind', accumulate }, AUTH)).status).toBe(400);
    }
  });
});
