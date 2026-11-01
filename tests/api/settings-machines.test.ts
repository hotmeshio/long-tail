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

  it('counts the lines this replica runs when the surface runs, and says nothing more', async () => {
    registerMachineSurface(surface());
    const settings = await getSettings();
    expect(settings.data.machines).toEqual({ declared: 1 });
    expect(JSON.stringify(settings.data)).not.toContain('press-01');
  });
});
