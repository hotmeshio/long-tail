import { describe, it, expect } from 'vitest';

import { loadLine } from '../../../examples/workflows/machine-line/line';
import {
  FACTORY_LINE_PATH, automatedAt, loadManifests, manifestSteps, personRoleConfigs,
} from '../../../examples/workflows/machine-line/manifests';

const line = loadLine(FACTORY_LINE_PATH);
const manifests = loadManifests();

describe('route manifests', () => {
  it('reads the automated manifest as machines on the factory line', () => {
    expect(manifestSteps(line, manifests.automated).map((s) => ('machineId' in s ? s.machineId : s.role)))
      .toEqual(['print-01', 'convey-01', 'press-01', 'cut-01', 'inspect-01']);
  });

  it('reads the manual manifest as a print cell, then people', () => {
    const steps = manifestSteps(line, manifests.manual);
    expect(steps[0]).toMatchObject({ machineId: 'print-02', process: 'print', role: 'line-print' });
    expect(steps.slice(1)).toEqual([{ role: 'harvester' }, { role: 'bonder' }, { role: 'finisher' }]);
  });

  it('declares the roles people work, leaving the exit role to the line', () => {
    expect(personRoleConfigs(line, manifests).map((r) => r.role)).toEqual(['harvester', 'bonder', 'finisher']);
  });

  it('spreads a percentage evenly and the same way every time', () => {
    const pick = (p: number) => Array.from({ length: 10 }, (_, i) => automatedAt(i, p));
    expect(pick(50).filter(Boolean)).toHaveLength(5);
    expect(pick(50)).toEqual(pick(50));
    expect(pick(30).filter(Boolean)).toHaveLength(3);
    expect(pick(0).some(Boolean)).toBe(false);
    expect(pick(100).every(Boolean)).toBe(true);
  });

  it('refuses a manifest naming a machine the line does not have', () => {
    expect(() => manifestSteps(line, { description: '', steps: ['oven-09'] })).toThrow(/oven-09/);
  });
});
