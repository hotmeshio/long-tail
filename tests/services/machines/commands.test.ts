import { describe, it, expect } from 'vitest';

import { OP } from '../../../lib/machines/protocol';
import { commandRow, commandTarget, readCommandFacets } from '../../../services/machines/commands';
import { ROW_TYPE } from '../../../services/machines/contracts';
import { DEFAULT_LINE } from '../../../examples/workflows/machine-line/line';

describe('commandTarget', () => {
  it('names the machine and the role its rows land on', () => {
    expect(commandTarget(DEFAULT_LINE, 'press-01')).toEqual({ siteId: DEFAULT_LINE.siteId, lineId: DEFAULT_LINE.lineId, machineId: 'press-01', role: 'line-bond' });
  });

  it('throws for a machine that is not on the line', () => {
    expect(() => commandTarget(DEFAULT_LINE, 'mill-99')).toThrow(/not on/);
  });
});

describe('commandRow', () => {
  it('builds a machine-command row on the machine role', () => {
    const row = commandRow(commandTarget(DEFAULT_LINE, 'press-01'), OP.PAUSE);
    expect(row).toMatchObject({ role: 'line-bond', type: ROW_TYPE.MACHINE_COMMAND, subtype: 'pause', description: 'pause press-01' });
    expect(row.metadata).toEqual({ siteId: DEFAULT_LINE.siteId, lineId: DEFAULT_LINE.lineId, machineId: 'press-01', op: 'pause', args: {} });
  });

  it('names the recipe in a changeover description', () => {
    const row = commandRow(commandTarget(DEFAULT_LINE, 'press-01'), OP.CHANGEOVER, { recipe: { id: 'R1', version: '2' } });
    expect(row.description).toBe('changeover press-01 to R1 v2');
  });
});

describe('readCommandFacets', () => {
  it('reads the facets back', () => {
    const { metadata } = commandRow(commandTarget(DEFAULT_LINE, 'cut-01'), OP.START);
    expect(readCommandFacets(metadata)).toMatchObject({ machineId: 'cut-01', op: 'start', args: {} });
  });

  it('is null without a machine or op', () => {
    expect(readCommandFacets({ siteId: 's', lineId: 'l', op: 'start' })).toBeNull();
    expect(readCommandFacets({ siteId: 's', lineId: 'l', machineId: 'm' })).toBeNull();
  });

  it('treats args that are not an object as none', () => {
    expect(readCommandFacets({ siteId: 's', lineId: 'l', machineId: 'm', op: 'start', args: [1] })!.args).toEqual({});
  });
});
