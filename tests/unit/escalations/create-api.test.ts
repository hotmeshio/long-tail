import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../services/escalation', () => ({
  createEscalation: vi.fn(),
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
const mockSchema = vi.mocked(roleService.getRoleMetadataSchema);
const mockAccess = vi.mocked(assertQueueManageAccess);

const AUTH = { userId: 'user-1' };

// A schema in the project's house style: extension keywords (x-lt-widget) plus
// a bare properties block. Ajv 8 strict mode throws at compile on both — the
// validator must accept this shape, since seeded form_schemas use it and role
// admins copy that style into metadata_schema.
const HOUSE_STYLE_SCHEMA = {
  properties: {
    order_id: { type: 'string', title: 'Order', 'x-lt-widget': 'lookup' },
    qty: { type: 'number' },
  },
  required: ['order_id'],
};

beforeEach(() => {
  vi.clearAllMocks();
  mockAccess.mockResolvedValue(null as any); // access granted
  mockCreate.mockResolvedValue({ id: 'esc-1' } as any);
});

describe('createEscalation — metadata validation', () => {
  it('accepts metadata matching a house-style schema with extension keywords (no strict-mode 500)', async () => {
    mockSchema.mockResolvedValue(HOUSE_STYLE_SCHEMA as any);
    const res = await createEscalation(
      { type: 'order', role: 'grind', metadata: { order_id: 'ORD-1', qty: 2 } },
      AUTH,
    );
    expect(res.status).toBe(201);
    expect(mockCreate).toHaveBeenCalled();
  });

  it('rejects metadata that fails the role schema with 400 and names the violation', async () => {
    mockSchema.mockResolvedValue(HOUSE_STYLE_SCHEMA as any);
    const res = await createEscalation(
      { type: 'order', role: 'grind', metadata: { qty: 2 } },
      AUTH,
    );
    expect(res.status).toBe(400);
    expect(res.error).toContain('order_id');
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('surfaces an uncompilable stored schema as 422 naming the role, never an opaque 500', async () => {
    mockSchema.mockResolvedValue({ type: 42 } as any); // invalid JSON Schema
    const res = await createEscalation(
      { type: 'order', role: 'grind', metadata: { anything: true } },
      AUTH,
    );
    expect(res.status).toBe(422);
    expect(res.error).toContain('grind');
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('skips validation when the role declares no schema', async () => {
    mockSchema.mockResolvedValue(null);
    const res = await createEscalation(
      { type: 'order', role: 'grind', metadata: { free: 'form' } },
      AUTH,
    );
    expect(res.status).toBe(201);
  });

  it('recompiles when the stored schema changes (cache keyed by schema content)', async () => {
    const roleA = `cache-role-${Date.now()}`;
    mockSchema.mockResolvedValue({ properties: { a: { type: 'string' } }, required: ['a'] } as any);
    let res = await createEscalation(
      { type: 'order', role: roleA, metadata: { a: 'x' } },
      AUTH,
    );
    expect(res.status).toBe(201);

    // Admin edits the schema: same role, new requirement — must take effect.
    mockSchema.mockResolvedValue({ properties: { b: { type: 'string' } }, required: ['b'] } as any);
    res = await createEscalation(
      { type: 'order', role: roleA, metadata: { a: 'x' } },
      AUTH,
    );
    expect(res.status).toBe(400);
    expect(res.error).toContain('b');
  });
});
