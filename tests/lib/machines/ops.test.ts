import { describe, it, expect } from 'vitest';

import {
  CONTROL_OPS, OP, commandOpsOf, declaredControlOps, declaredRowOps, oneWayOps, rowOpArgs, rowOpSettleMs,
} from '../../../lib/machines/protocol';

const SETPOINT = { type: 'object', required: ['name'], properties: { name: { type: 'string' } } };

describe('control ops', () => {
  it('are every control op the line protocol defines unless the codec names fewer', () => {
    expect(declaredControlOps({})).toEqual(CONTROL_OPS);
    expect(declaredControlOps({ controlOps: [OP.STOP, OP.CANCEL] })).toEqual([OP.STOP, OP.CANCEL]);
  });

  it('refuse an op the line protocol does not define as a control op', () => {
    expect(() => declaredControlOps({ controlOps: [OP.STOP, OP.DISPATCH] })).toThrow(/controlOps names dispatch/);
    expect(() => declaredControlOps({ controlOps: 'stop' as any })).toThrow(/controlOps/);
  });
});

describe('the ops a command row may ask for', () => {
  it('are the control ops, a snapshot, and the codec\'s own, once each', () => {
    expect(commandOpsOf({})).toEqual([...CONTROL_OPS, OP.SNAPSHOT]);
    expect(commandOpsOf({ rowOps: ['probe', OP.PAUSE] })).toEqual([...CONTROL_OPS, OP.SNAPSHOT, 'probe']);
    expect(commandOpsOf({})).not.toContain(OP.DISPATCH);
  });

  it('leave out the control ops the codec does not declare', () => {
    expect(commandOpsOf({ controlOps: [OP.STOP], rowOps: ['probe'] })).toEqual([OP.STOP, OP.SNAPSHOT, 'probe']);
  });
});

describe('row op declarations', () => {
  it('read names, reply modes, argument schemas and settle windows', () => {
    const codec = { rowOps: ['probe', { op: 'beacon', reply: false }, { op: 'setpoint', args: SETPOINT, settleMs: 30_000 }] };
    expect(declaredRowOps(codec)).toEqual(['probe', 'beacon', 'setpoint']);
    expect([...oneWayOps(codec)]).toEqual(['beacon']);
    expect(rowOpArgs(codec)).toEqual({ setpoint: SETPOINT });
    expect(rowOpSettleMs(codec)).toEqual({ setpoint: 30_000 });
  });

  it('refuse args that are not a schema object', () => {
    expect(() => declaredRowOps({ rowOps: [{ op: 'setpoint', args: [] as any }] })).toThrow(/setpoint: args/);
  });

  it('refuse a settle window that is not a positive integer, or one on an op with no reply', () => {
    expect(() => declaredRowOps({ rowOps: [{ op: 'setpoint', settleMs: 0 }] })).toThrow(/settleMs/);
    expect(() => declaredRowOps({ rowOps: [{ op: 'setpoint', settleMs: 1.5 }] })).toThrow(/settleMs/);
    expect(() => declaredRowOps({ rowOps: [{ op: 'beacon', reply: false, settleMs: 100 }] })).toThrow(/one-way/);
  });
});
