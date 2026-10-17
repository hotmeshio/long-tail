import { describe, it, expect } from 'vitest';
import { writeFileSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { machineLineRoleData } from '../../../examples/seed-machine-line';
import { DEFAULT_LINE } from '../../../examples/workflows/machine-line/line';

describe('example machine line role seed', () => {
  it('reads the line from MACHINE_LINE_CONFIG and gives machines sharing a process one role', () => {
    const line = structuredClone(DEFAULT_LINE);
    line.machines.push({ ...line.machines[1], machineId: 'cut-02' });
    const dir = mkdtempSync(join(tmpdir(), 'line-'));
    const path = join(dir, 'line.json');
    writeFileSync(path, JSON.stringify(line));
    expect(machineLineRoleData(path).filter((r) => r.role === 'line-trim')).toHaveLength(1);
  });
});
