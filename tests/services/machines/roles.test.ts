import { describe, it, expect } from 'vitest';

import { DEFAULT_LINE } from '../../../examples/workflows/machine-line/line';
import { machineRoleConfigs, withMachineRoles } from '../../../services/machines/roles';

describe('machine line roles', () => {
  it('chains the station roles in route order into exit, with the operator beside them', () => {
    const roles = machineRoleConfigs(DEFAULT_LINE);
    expect(roles.map((r) => r.role)).toEqual(['line-bond', 'line-trim', 'line-inspect', 'line-exit', 'line-operator']);
    expect(roles.map((r) => r.parent_role)).toEqual([undefined, 'line-bond', 'line-trim', 'line-inspect', undefined]);
    expect(roles.find((r) => r.role === 'line-exit')?.upstream_roles).toEqual(['line-operator']);
  });

  it('enforces the form only on the operator role', () => {
    expect(machineRoleConfigs(DEFAULT_LINE).filter((r) => r.enforce_schema).map((r) => r.role)).toEqual(['line-operator']);
  });

  it('keeps every role the host declared and adds only the missing ones, once across lines', () => {
    const host = [{ role: 'line-exit', title: 'Quality inspection' }];
    const second = { ...DEFAULT_LINE, lineId: 'line-2' };
    const merged = withMachineRoles(host, [DEFAULT_LINE, second]);
    expect(merged.filter((r) => r.role === 'line-exit')).toEqual(host);
    expect(merged.map((r) => r.role).filter((r) => r === 'line-bond')).toHaveLength(1);
    expect(merged).toHaveLength(5);
  });
});
