import { describe, it, expect } from 'vitest';
import { join } from 'path';

import { FACTORY_LINE_PATH } from '../../../examples/workflows/machine-line/manifests';
import { learnedLine, loadLine, readAddresses, withAddresses } from '../../../examples/workflows/machine-line/line';
import { clientIds } from '../../../lib/machines/line';

const ADDRESSES_PATH = join(__dirname, '../../../examples/workflows/machine-line/factory-line-addresses.json');

describe('the example line, with and without learned addresses', () => {
  it('gives each factory station its machine\'s permanent address, one address per machine', () => {
    const addresses = readAddresses(ADDRESSES_PATH)!;
    const line = loadLine(FACTORY_LINE_PATH);
    expect(Object.keys(addresses).sort()).toEqual(line.machines.map((m) => m.machineId).sort());
    expect(new Set(Object.values(addresses)).size).toBe(line.machines.length);
    const machines = withAddresses(line, addresses);
    expect(machines.machines.every((m) => m.address === addresses[m.machineId])).toBe(true);
  });

  it('the gateway\'s view names stations only and learns every address', () => {
    const learned = learnedLine(withAddresses(loadLine(FACTORY_LINE_PATH), readAddresses(ADDRESSES_PATH)));
    expect(learned.addressing).toBe('learned');
    expect(learned.machines.some((m) => m.address)).toBe(false);
    expect(clientIds(learned)).toEqual([]);
  });

  it('without an addresses file the line is unchanged', () => {
    const line = loadLine(FACTORY_LINE_PATH);
    expect(readAddresses(undefined)).toBeNull();
    expect(withAddresses(line, null)).toBe(line);
  });
});
