import { describe, it, expect } from 'vitest';

import { CONTROL_OPS, OP } from '../../../lib/machines/protocol';
import { commandOpsOf, summarizeLine } from '../../../services/machines/surface';
import { DEFAULT_LINE } from '../../../examples/workflows/machine-line/line';

describe('describing a line', () => {
  it('lists each machine with its process, role, declared address and the codec\'s own ops', () => {
    const summary = summarizeLine(DEFAULT_LINE, { rowOps: ['probe'] });
    expect(summary).toMatchObject({ siteId: 'site-1', lineId: 'line-1' });
    expect(summary.machines[0]).toEqual({ machineId: 'press-01', process: 'bond', role: 'line-bond', address: 'press-01', addressing: 'declared', rowOps: ['probe'] });
    expect(summary.machines.map((m) => m.machineId)).toEqual(['press-01', 'cut-01', 'inspect-01']);
  });

  it('leaves rowOps out when the codec declares none, and keeps a declared address', () => {
    const [press, ...rest] = DEFAULT_LINE.machines;
    const summary = summarizeLine({ ...DEFAULT_LINE, machines: [{ ...press, address: '8f77e321' }, ...rest] }, {});
    expect(summary.machines[0]).toEqual({ machineId: 'press-01', process: 'bond', role: 'line-bond', address: '8f77e321', addressing: 'declared' });
    expect('rowOps' in summary.machines[0]).toBe(false);
  });

  it('a line that learns addresses has none to show until a machine claims a station', () => {
    const summary = summarizeLine({ ...DEFAULT_LINE, addressing: 'learned' }, {});
    expect(summary.machines[0]).toMatchObject({ address: null, addressing: 'learned' });
  });

  it('refuses a codec whose row ops are not names', () => {
    expect(() => summarizeLine(DEFAULT_LINE, { rowOps: ['', 'probe'] })).toThrow(/rowOps/);
  });
});

describe('the ops a command row may ask for', () => {
  it('are the control ops, a snapshot, and the codec\'s own, once each', () => {
    expect(commandOpsOf({})).toEqual([...CONTROL_OPS, OP.SNAPSHOT]);
    expect(commandOpsOf({ rowOps: ['probe', OP.PAUSE] })).toEqual([...CONTROL_OPS, OP.SNAPSHOT, 'probe']);
    expect(commandOpsOf({})).not.toContain(OP.DISPATCH);
  });
});
