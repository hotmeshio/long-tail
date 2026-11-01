import { describe, it, expect } from 'vitest';

import { DEFAULT_LINE } from '../../../examples/workflows/machine-line/line';
import { machineRoleConfigs, withMachineRoles } from '../../../services/machines/roles';

describe('machine line roles', () => {
  it('chains the station roles in route order into exit, with the operator beside them', () => {
    const roles = machineRoleConfigs(DEFAULT_LINE);
    expect(roles.map((r) => r.role)).toEqual(['line-bond', 'line-trim', 'line-inspect', 'line-exit', 'line-operator', 'line-quality']);
    expect(roles.map((r) => r.parent_role)).toEqual([undefined, 'line-bond', 'line-trim', 'line-inspect', undefined, undefined]);
    expect(roles.find((r) => r.role === 'line-exit')?.upstream_roles).toEqual(['line-operator']);
  });

  it('enforces the form on the operator and quality roles, which people answer', () => {
    expect(machineRoleConfigs(DEFAULT_LINE).filter((r) => r.enforce_schema).map((r) => r.role)).toEqual(['line-operator', 'line-quality']);
    expect(machineRoleConfigs({ ...DEFAULT_LINE, roles: { quality: 'qa' } }).map((r) => r.role)).toContain('qa');
  });

  it('keeps every role the host declared and adds only the missing ones, once across lines', () => {
    const host = [{ role: 'line-exit', title: 'Quality inspection' }];
    const second = { ...DEFAULT_LINE, lineId: 'line-2' };
    const merged = withMachineRoles(host, [DEFAULT_LINE, second]);
    expect(merged.filter((r) => r.role === 'line-exit')).toEqual(host);
    expect(merged.map((r) => r.role).filter((r) => r === 'line-bond')).toHaveLength(1);
    expect(merged).toHaveLength(6);
  });
});
