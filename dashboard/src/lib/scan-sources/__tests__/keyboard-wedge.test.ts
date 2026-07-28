import { describe, it, expect } from 'vitest';

import {
  createWedgeMachine,
  WEDGE_DEFAULTS,
  type WedgeKey,
} from '../keyboard-wedge';

const key = (k: string, timeMs: number, extra: Partial<WedgeKey> = {}): WedgeKey => ({
  key: k,
  timeMs,
  hasModifier: false,
  isRepeat: false,
  ...extra,
});

/** Feed a string at a fixed inter-key interval; returns emits and suppressions. */
function feed(
  machine: ReturnType<typeof createWedgeMachine>,
  text: string,
  intervalMs: number,
  startMs = 1000,
  terminator = 'Enter',
) {
  const emits: string[] = [];
  let suppressed = 0;
  let t = startMs;
  for (const ch of text) {
    const step = machine.step(key(ch, t));
    if (step.suppress) suppressed++;
    if (step.emit) emits.push(step.emit);
    t += intervalMs;
  }
  const final = machine.step(key(terminator, t));
  if (final.suppress) suppressed++;
  if (final.emit) emits.push(final.emit);
  return { emits, suppressed };
}

describe('keyboard-wedge burst machine', () => {
  it('captures a scanner-speed burst terminated by Enter', () => {
    const machine = createWedgeMachine();
    const { emits } = feed(machine, '1:01:SN-123', 20);
    expect(emits).toEqual(['1:01:SN-123']);
  });

  it('captures at Bluetooth-iPad speeds (60ms between keys)', () => {
    const machine = createWedgeMachine();
    const { emits } = feed(machine, '1:02:75949975930', 60);
    expect(emits).toEqual(['1:02:75949975930']);
  });

  it('never emits for human typing (200ms between keys)', () => {
    const machine = createWedgeMachine();
    const { emits, suppressed } = feed(machine, '1:01:SN-123', 200);
    expect(emits).toEqual([]);
    expect(suppressed).toBe(0);
  });

  it('suppresses burst keys so they never reach a focused field', () => {
    const machine = createWedgeMachine();
    const { suppressed } = feed(machine, '1:01:AB', 20);
    // First char leaks (no prefix); the rest of the burst + Enter suppress.
    expect(suppressed).toBe('1:01:AB'.length - 1 + 1);
  });

  it('suppresses everything from the first key when a prefix is configured', () => {
    const machine = createWedgeMachine({ ...WEDGE_DEFAULTS, prefixChar: '§' });
    const { emits, suppressed } = feed(machine, '§1:01:AB', 20);
    expect(emits).toEqual(['1:01:AB']);
    expect(suppressed).toBe('§1:01:AB'.length + 1); // every key + Enter
  });

  it('suppresses the terminator of a too-short burst without emitting', () => {
    const machine = createWedgeMachine();
    const { emits, suppressed } = feed(machine, 'ab', 20);
    expect(emits).toEqual([]);
    expect(suppressed).toBeGreaterThan(0); // the armed Enter never submits a form
  });

  it('ignores modifier chords and key repeats', () => {
    const machine = createWedgeMachine();
    machine.step(key('1', 1000));
    machine.step(key('c', 1010, { hasModifier: true })); // Cmd+C mid-stream
    const step = machine.step(key('Enter', 1020));
    expect(step.emit).toBeNull();

    machine.reset();
    machine.step(key('1', 2000));
    machine.step(key('1', 2010, { isRepeat: true }));
    expect(machine.step(key('Enter', 2020)).emit).toBeNull();
  });

  it('skips Unidentified keys (iPadOS quirk) by resetting', () => {
    const machine = createWedgeMachine();
    machine.step(key('1', 1000));
    machine.step(key(':', 1020));
    machine.step(key('Unidentified', 1040));
    expect(machine.step(key('Enter', 1060)).emit).toBeNull();
  });

  it('abandons a burst that goes cold mid-capture', () => {
    const machine = createWedgeMachine();
    machine.step(key('1', 1000));
    machine.step(key(':', 1020)); // capture armed
    machine.step(key('0', 1500)); // 480ms gap — human resumed typing
    expect(machine.step(key('Enter', 1520)).emit).toBeNull();
  });

  it('honors a custom threshold', () => {
    const machine = createWedgeMachine({ ...WEDGE_DEFAULTS, interKeyThresholdMs: 150 });
    const { emits } = feed(machine, '1:01:SN-9', 120);
    expect(emits).toEqual(['1:01:SN-9']);
  });

  it('captures back-to-back scans independently', () => {
    const machine = createWedgeMachine();
    const first = feed(machine, '1:01:AAA1', 20, 1000);
    const second = feed(machine, '1:02:BBB2', 20, 5000);
    expect(first.emits).toEqual(['1:01:AAA1']);
    expect(second.emits).toEqual(['1:02:BBB2']);
  });
});
