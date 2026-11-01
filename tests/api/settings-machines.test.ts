import { describe, it, expect, afterEach } from 'vitest';

import { getSettings } from '../../api/settings';
import { registerMachineSurface } from '../../modules/machines';
import { summarizeLine, type LineSurface } from '../../services/machines/surface';
import { DEFAULT_LINE } from '../../examples/workflows/machine-line/line';

afterEach(() => registerMachineSurface(null));

function surface(): LineSurface {
  return {
    describeLines: () => [summarizeLine(DEFAULT_LINE, { rowOps: ['probe'] })],
    describeLine: () => null,
    inspect: () => null,
    findLine: () => DEFAULT_LINE,
    commandOps: () => [],
  };
}

describe('settings and the machine surface', () => {
  it('has no machines block when start() declared no lines', async () => {
    registerMachineSurface(null);
    const settings = await getSettings();
    expect(settings.status).toBe(200);
    expect(settings.data).not.toHaveProperty('machines');
  });

  it('lists the declared lines when the surface runs', async () => {
    registerMachineSurface(surface());
    const settings = await getSettings();
    expect(settings.data.machines).toEqual({ lines: [summarizeLine(DEFAULT_LINE, { rowOps: ['probe'] })] });
    expect(settings.data.machines.lines[0].machines[0]).toMatchObject({ machineId: 'press-01', role: 'line-bond', rowOps: ['probe'] });
  });
});
