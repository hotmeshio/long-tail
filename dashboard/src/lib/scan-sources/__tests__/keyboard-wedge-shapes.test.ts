import { describe, it, expect } from 'vitest';

import {
  buildTailShapes,
  createWedgeMachine,
  matchScanTail,
  WEDGE_DEFAULTS,
  type CaptureScheme,
  type WedgeKey,
} from '../keyboard-wedge';

const key = (k: string, timeMs: number): WedgeKey => ({ key: k, timeMs, hasModifier: false, isRepeat: false });

function typeThenEnter(machine: ReturnType<typeof createWedgeMachine>, text: string, intervalMs: number) {
  let t = 1000;
  for (const ch of text) { machine.step(key(ch, t)); t += intervalMs; }
  return machine.step(key('Enter', t));
}

const scheme = (over: Partial<CaptureScheme>): CaptureScheme =>
  ({ version: 11, encoding: 'delimited', delimiter: ':', target_length: null, enabled: true, ...over });

const SHAPES = buildTailShapes([
  scheme({}),
  scheme({ version: 12 }),
  scheme({ version: 16, encoding: 'gtin' }),
  scheme({ version: 20, encoding: 'fixed', target_length: 6 }),
]);

describe('buildTailShapes', () => {
  it('reads only the configured delimited versions', () => {
    expect(matchScanTail('11:0:K7Q2M9XA', SHAPES)).toBe('11:0:K7Q2M9XA');
    expect(matchScanTail('12:0:HB-1A2B', SHAPES)).toBe('12:0:HB-1A2B');
    expect(matchScanTail('13:0:K7Q2M9XA', SHAPES)).toBeNull();
  });

  it('keeps a UPC-A leading zero and rejects a bad check digit', () => {
    expect(matchScanTail('012345678905', SHAPES)).toBe('012345678905');
    expect(matchScanTail('012345678904', SHAPES)).toBeNull();
  });

  it('a fixed scheme reads exactly its own lengths', () => {
    expect(matchScanTail('201755433', SHAPES)).toBe('201755433');
    expect(matchScanTail('2017554332', SHAPES)).toBe('2017554332');
    expect(matchScanTail('20175543321', SHAPES)).toBeNull();
  });

  it('a code never starts inside a longer digit run', () => {
    expect(matchScanTail('911:0:K7Q2M9XA', SHAPES)).toBeNull();
  });

  it('with no enabled schemes the generic shapes stand in', () => {
    expect(matchScanTail('11:0:X1Y2Z3', buildTailShapes([scheme({ enabled: false })]))).toBe('11:0:X1Y2Z3');
    expect(buildTailShapes([]).length).toBe(2);
  });
});

describe('digits-only codes fire only at scanner speed', () => {
  it('a scanned UPC fires and is stripped from the field', () => {
    const step = typeThenEnter(createWedgeMachine(WEDGE_DEFAULTS, SHAPES), '012345678905', 10);
    expect(step).toMatchObject({ emit: '012345678905', suppress: true, consumedLength: 12 });
  });

  it('a typed PO number that happens to be a valid UPC stays in its field', () => {
    const step = typeThenEnter(createWedgeMachine(WEDGE_DEFAULTS, SHAPES), '012345678905', 140);
    expect(step).toMatchObject({ emit: null, suppress: false });
  });

  it('a typed delimited code still fires (the keyboard is a scanner)', () => {
    const step = typeThenEnter(createWedgeMachine(WEDGE_DEFAULTS, SHAPES), '11:0:K7Q2M9XA', 140);
    expect(step.emit).toBe('11:0:K7Q2M9XA');
  });

  it('auto-fire offers a suffix-less scanned UPC', () => {
    const machine = createWedgeMachine(WEDGE_DEFAULTS, SHAPES);
    let t = 1000;
    for (const ch of '036000291452') { machine.step(key(ch, t)); t += 8; }
    expect(machine.pendingAutoFire()?.code).toBe('036000291452');
  });
});
