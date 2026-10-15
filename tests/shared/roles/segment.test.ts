import { describe, it, expect } from 'vitest';

import { buildRoleSequences, segmentRoles } from '../../../shared/roles/segment';

const roles = [
  { role: 'prep', parent_role: null, ops_visible: true },
  { role: 'check', parent_role: 'prep', ops_visible: true },
  { role: 'stage', parent_role: 'check', ops_visible: true },
  { role: 'rework', parent_role: 'check', ops_visible: true },
  { role: 'audit', parent_role: null, ops_visible: true },
  { role: 'hidden', parent_role: 'prep', ops_visible: false },
  { role: 'loop-a', parent_role: 'loop-b', ops_visible: true },
  { role: 'loop-b', parent_role: 'loop-a', ops_visible: true },
];

describe('role sequences', () => {
  it('walks each root breadth-first, longest first', () => {
    const sequences = buildRoleSequences(roles);
    expect(sequences[0].stations.map((s) => [s.role.role, s.depth])).toEqual([
      ['prep', 0], ['check', 1], ['stage', 2], ['rework', 2],
    ]);
    expect(sequences.map((s) => s.origin.role)).toContain('audit');
  });

  it('keeps unreachable roles as their own sequences', () => {
    const origins = buildRoleSequences(roles).map((s) => s.origin.role);
    expect(origins).toEqual(expect.arrayContaining(['loop-a', 'loop-b']));
    expect(origins).not.toContain('hidden');
  });

  it('resolves a segment by its first role', () => {
    expect(segmentRoles(roles, 'prep')).toEqual(['prep', 'check', 'stage', 'rework']);
    expect(segmentRoles(roles, 'check')).toBeNull();
    expect(segmentRoles(roles, 'nope')).toBeNull();
  });
});
