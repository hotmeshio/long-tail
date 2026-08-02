import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../services/role', () => ({
  updateRoleMetadata: vi.fn(),
  listDistinctRoles: vi.fn(),
}));

import * as roleService from '../../../services/role';
import { updateRole } from '../../../api/roles';

const mockUpdate = vi.mocked(roleService.updateRoleMetadata);

// ─────────────────────────────────────────────────────────────────────────────
// updateRole — input validation for the entity dials.
//
// entity_facet is interpolated into SQL as a JSON path (metadata->>key) by the
// analytics builders, so the API must reject anything outside the FACET_KEY
// charset before it reaches the service. entity_state_source is a closed enum:
// 'role' | 'subtype' | null (null resets to the 'role' default).
// ─────────────────────────────────────────────────────────────────────────────

describe('api/roles updateRole — entity dial validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdate.mockResolvedValue({ role: 'printer-fleet' } as any);
  });

  it.each(['metadata.serialNumber', 'has space', "quo'te", 'dash-ed', ''])(
    'rejects entity_facet %j',
    async (facet) => {
      const result = await updateRole({ role: 'printer-fleet', entity_facet: facet });
      expect(result.status).toBe(400);
      expect(result.error).toContain('entity_facet');
      expect(mockUpdate).not.toHaveBeenCalled();
    },
  );

  it.each(['queue', 'ROLE', 'Subtype', ''])(
    'rejects entity_state_source %j (closed enum)',
    async (source) => {
      const result = await updateRole({ role: 'printer-fleet', entity_state_source: source as any });
      expect(result.status).toBe(400);
      expect(result.error).toContain('entity_state_source');
      expect(mockUpdate).not.toHaveBeenCalled();
    },
  );

  it.each(['role', 'subtype'] as const)(
    'accepts entity_state_source %j and forwards it',
    async (source) => {
      const result = await updateRole({
        role: 'printer-fleet',
        entity_facet: 'serialNumber',
        entity_state_source: source,
      });
      expect(result.status).toBe(200);
      expect(mockUpdate).toHaveBeenCalledWith('printer-fleet', expect.objectContaining({
        entity_facet: 'serialNumber',
        entity_state_source: source,
      }));
    },
  );

  it('accepts explicit nulls to clear the facet and reset the source', async () => {
    const result = await updateRole({
      role: 'printer-fleet',
      entity_facet: null,
      entity_state_source: null,
    });
    expect(result.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledWith('printer-fleet', expect.objectContaining({
      entity_facet: null,
      entity_state_source: null,
    }));
  });

  it('omitting both dials keeps them out of a PATCH of other fields', async () => {
    const result = await updateRole({ role: 'printer-fleet', title: 'Printer Fleet' });
    expect(result.status).toBe(200);
    const forwarded = mockUpdate.mock.calls[0][1];
    expect(forwarded.entity_facet).toBeUndefined();
    expect(forwarded.entity_state_source).toBeUndefined();
  });
});
