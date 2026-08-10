import { describe, it, expect, vi, beforeEach } from 'vitest';

// The cancel receipt carries the ROLE'S OWN on_cancel semantics (the reserved
// lt_roles.properties key) — cancel means different things on different queues.

vi.mock('../../services/escalation', () => ({
  getEscalation: vi.fn(),
  cancelEscalation: vi.fn(),
}));
vi.mock('../../services/role', () => ({
  getRoleProperties: vi.fn(),
}));
vi.mock('../../api/escalations/helpers', () => ({
  validateIds: vi.fn(),
  checkBulkPermission: vi.fn(),
  assertWriteAccess: vi.fn().mockResolvedValue(null),
}));

import * as escalationService from '../../services/escalation';
import * as roleService from '../../services/role';
import { cancelSingleEscalation } from '../../api/escalations/cancel';

const mockGet = vi.mocked(escalationService.getEscalation);
const mockCancel = vi.mocked(escalationService.cancelEscalation);
const mockProps = vi.mocked(roleService.getRoleProperties);

const row = { id: 'esc-1', role: 'print-operator', status: 'pending' } as any;
const auth = { userId: 'u-1', role: 'admin' } as any;

beforeEach(() => {
  vi.clearAllMocks();
  mockGet.mockResolvedValue(row);
  mockCancel.mockResolvedValue({ ...row, status: 'cancelled' });
});

describe('cancelSingleEscalation — on_cancel note', () => {
  it('returns role + note when the role declares on_cancel', async () => {
    mockProps.mockResolvedValue({ on_cancel: 'reset — the dispatcher re-mints the attempt' });
    const result = await cancelSingleEscalation({ id: 'esc-1' }, auth);
    expect(result.status).toBe(200);
    expect(result.data).toEqual({
      cancelled: true,
      escalationId: 'esc-1',
      role: 'print-operator',
      note: 'reset — the dispatcher re-mints the attempt',
    });
  });

  it('omits the note when on_cancel is absent or non-string (open bag)', async () => {
    mockProps.mockResolvedValue({ color: 'blue' });
    let result = await cancelSingleEscalation({ id: 'esc-1' }, auth);
    expect(result.data).toEqual({ cancelled: true, escalationId: 'esc-1', role: 'print-operator' });

    mockProps.mockResolvedValue({ on_cancel: { nested: 'object' } });
    result = await cancelSingleEscalation({ id: 'esc-1' }, auth);
    expect((result.data as any).note).toBeUndefined();

    mockProps.mockResolvedValue(null);
    result = await cancelSingleEscalation({ id: 'esc-1' }, auth);
    expect((result.data as any).note).toBeUndefined();
  });
});
