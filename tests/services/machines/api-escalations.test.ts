import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../api/escalations', () => ({
  createEscalation: vi.fn(),
  getEscalationItems: vi.fn(),
}));

import * as escalationApi from '../../../api/escalations';
import { ApiLineEscalations } from '../../../services/machines/gateway/api-escalations';
import { CONTROLLER } from '../../../services/machines/gateway/actions';

const create = vi.mocked(escalationApi.createEscalation);
const items = vi.mocked(escalationApi.getEscalationItems);
const lt = new ApiLineEscalations(() => 'controller-user');
const ROW = { type: 'machine-request', role: 'press', signal_key: 'k-1' } as any;

beforeEach(() => vi.clearAllMocks());

describe('ApiLineEscalations', () => {
  it('a create returns the row status and creation time, so a held key reads as the row it is', async () => {
    const created_at = new Date('2026-11-10T08:00:00Z');
    create.mockResolvedValue({ status: 200, data: { id: 'esc-1', status: 'resolved', created_at } } as any);
    expect(await lt.create(CONTROLLER, ROW)).toEqual({ id: 'esc-1', status: 'resolved', created_at: created_at.toISOString() });
  });

  it('a new row carries its pending status', async () => {
    create.mockResolvedValue({ status: 201, data: { id: 'esc-2', status: 'pending', created_at: '2026-11-10T08:00:00.000Z' } } as any);
    expect(await lt.create(CONTROLLER, ROW)).toMatchObject({ id: 'esc-2', status: 'pending' });
  });

  it('a refused create throws', async () => {
    create.mockResolvedValue({ status: 409, error: 'signal_key is held by another row' } as any);
    await expect(lt.create(CONTROLLER, ROW)).rejects.toThrow(/409/);
  });

  it('items carry who added them', async () => {
    items.mockResolvedValue({ status: 200, data: { items: [{ itemKey: 'answer', payload: { args: {} }, actor: 'user-7' }, { itemKey: 'x' }] } } as any);
    expect(await lt.items('esc-1')).toEqual([
      { itemKey: 'answer', payload: { args: {} }, actor: 'user-7' },
      { itemKey: 'x', payload: {} },
    ]);
  });

  it('a row that holds no items reads as none', async () => {
    items.mockResolvedValue({ status: 400, error: 'Escalation holds no items' } as any);
    expect(await lt.items('esc-1')).toEqual([]);
  });
});
