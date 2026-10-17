import { describe, it, expect } from 'vitest';
import { writeFileSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { machineLineRoleData } from '../../../examples/seed-machine-line';
import { DEFAULT_LINE } from '../../../examples/workflows/machine-line/line';

describe('machine line roles', () => {
  it('chains one station role per process into line exit, with the operator merging in', () => {
    const roles = machineLineRoleData(undefined);
    expect(roles.map((r) => [r.role, r.parent_role])).toEqual([
      ['line-bond', null], ['line-trim', 'line-bond'], ['line-inspect', 'line-trim'],
      ['line-exit', 'line-inspect'], ['line-operator', null],
    ]);
    expect(roles.find((r) => r.role === 'line-exit')?.upstream_roles).toEqual(['line-operator']);
  });

  it('enforces the form on the operator role only', () => {
    expect(machineLineRoleData(undefined).filter((r) => r.enforce_schema).map((r) => r.role)).toEqual(['line-operator']);
  });

  it('reads the line from MACHINE_LINE_CONFIG and gives machines sharing a process one role', () => {
    const line = structuredClone(DEFAULT_LINE);
    line.machines.push({ ...line.machines[1], machineId: 'cut-02' });
    const dir = mkdtempSync(join(tmpdir(), 'line-'));
    const path = join(dir, 'line.json');
    writeFileSync(path, JSON.stringify(line));
    expect(machineLineRoleData(path).filter((r) => r.role === 'line-trim')).toHaveLength(1);
  });
});
