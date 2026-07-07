import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../services/role', () => ({
  updateRoleMetadata: vi.fn(),
  listDistinctRoles: vi.fn(),
}));

import * as roleService from '../../../services/role';
import { updateRole } from '../../../api/roles';

const mockUpdate = vi.mocked(roleService.updateRoleMetadata);

// ─────────────────────────────────────────────────────────────────────────────
// updateRole — input validation for the priority dials.
//
// priority_facet is interpolated into SQL as a JSON path (metadata->>key), so
// the API must reject anything outside the FACET_KEY charset before it reaches
// the service. priority_threshold_minutes shares the non-negative-number rule
// with the other ops dials.
// ─────────────────────────────────────────────────────────────────────────────

describe('api/roles updateRole — priority dial validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdate.mockResolvedValue({ role: 'gluer' } as any);
  });

  it('rejects a negative priority_threshold_minutes', async () => {
    const result = await updateRole({ role: 'gluer', priority_threshold_minutes: -5 });
    expect(result.status).toBe(400);
    expect(result.error).toContain('priority_threshold_minutes');
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('rejects a non-numeric priority_threshold_minutes', async () => {
    const result = await updateRole({ role: 'gluer', priority_threshold_minutes: NaN });
    expect(result.status).toBe(400);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it.each(['metadata.authorized_at', 'has space', "quo'te", 'dash-ed', ''])(
    'rejects priority_facet %j',
    async (facet) => {
      const result = await updateRole({ role: 'gluer', priority_facet: facet });
      expect(result.status).toBe(400);
      expect(result.error).toContain('priority_facet');
      expect(mockUpdate).not.toHaveBeenCalled();
    },
  );

  it('accepts a valid dial pair and forwards it to the service', async () => {
    const result = await updateRole({
      role: 'gluer',
      priority_threshold_minutes: 240,
      priority_facet: 'authorized_at',
    });
    expect(result.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledWith('gluer', expect.objectContaining({
      priority_threshold_minutes: 240,
      priority_facet: 'authorized_at',
    }));
  });

  it('accepts explicit nulls to clear both dials', async () => {
    const result = await updateRole({
      role: 'gluer',
      priority_threshold_minutes: null,
      priority_facet: null,
    });
    expect(result.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledWith('gluer', expect.objectContaining({
      priority_threshold_minutes: null,
      priority_facet: null,
    }));
  });
});
