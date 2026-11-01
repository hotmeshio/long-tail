import { describe, it, expect } from 'vitest';
import { join } from 'path';

import { loadLine } from '../../../examples/workflows/machine-line/line';
import { loadManifests, manifestSteps } from '../../../examples/workflows/machine-line/manifests';
import { exitRole } from '../../../lib/machines/line';

const EXAMPLE = join(__dirname, '../../../examples/workflows/machine-line');
const line = loadLine(join(EXAMPLE, 'factory-line-south.json'));
const manifests = loadManifests(join(EXAMPLE, 'route-manifests-south.json'));

// The south site's line: a second line for the index, driven by its own manifests.

describe('the south line', () => {
  it('is a second site with its own machines and the same exit role', () => {
    expect([line.siteId, line.lineId]).toEqual(['site-2', 'line-1']);
    expect(line.machines.map((m) => m.machineId)).toEqual(['print-21', 'press-21', 'inspect-21']);
    expect(exitRole(line)).toBe('inspector');
  });

  it('its manifests name only its machines, automated and manual', () => {
    const automated = manifestSteps(line, manifests.automated);
    expect(automated).toHaveLength(3);
    const manual = manifestSteps(line, manifests.manual);
    expect(manual.filter((s) => 'role' in s && !('machineId' in s)).length).toBe(2);
    expect(() => manifestSteps(line, { description: '', steps: ['press-01'] })).toThrow();
  });
});
