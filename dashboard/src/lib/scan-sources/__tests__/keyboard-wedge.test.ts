import { describe, it, expect } from 'vitest';

import {
  createWedgeMachine,
  matchScanTail,
  WEDGE_DEFAULTS,
  type WedgeKey,
  type WedgeStep,
} from '../keyboard-wedge';

const key = (k: string, timeMs: number, extra: Partial<WedgeKey> = {}): WedgeKey => ({
  key: k,
  timeMs,
  hasModifier: false,
  isRepeat: false,
  ...extra,
});

/** Feed a string at a fixed inter-key interval, then a terminator. */
function feed(
  machine: ReturnType<typeof createWedgeMachine>,
  text: string,
  intervalMs: number,
  startMs = 1000,
  terminator = 'Enter',
): { final: WedgeStep; suppressedDuringText: number } {
  let suppressedDuringText = 0;
  let t = startMs;
  for (const ch of text) {
    if (machine.step(key(ch, t)).suppress) suppressedDuringText++;
    t += intervalMs;
  }
  return { final: machine.step(key(terminator, t)), suppressedDuringText };
}

describe('matchScanTail', () => {
  it('matches a delimited code at the end of unrelated text', () => {
    expect(matchScanTail('note about x 1:04:SN-TEST-8')).toBe('1:04:SN-TEST-8');
  });

  it('matches lowercase, digits, dot, underscore, dash targets', () => {
    expect(matchScanTail('1:99:abc.def_9-x')).toBe('1:99:abc.def_9-x');
  });

  it('matches a fixed digits-only code', () => {
    expect(matchScanTail('20175433211')).toBe('20175433211');
  });

  it('returns null for text without a code tail', () => {
    expect(matchScanTail('hello world')).toBeNull();
    expect(matchScanTail('1:4:short')).toBeNull(); // one-digit category
    expect(matchScanTail('0:04:x')).toBeNull();    // version 0 reserved
  });
});

describe('keyboard-wedge capture (pattern-anchored)', () => {
  it('captures a scanner burst and consumes the full code length', () => {
    const machine = createWedgeMachine();
    const { final } = feed(machine, '1:04:SN-TEST-8', 20);
    expect(final.emit).toBe('1:04:SN-TEST-8');
    expect(final.suppress).toBe(true);
    expect(final.consumedLength).toBe('1:04:SN-TEST-8'.length);
  });

  it('never suppresses during accumulation — only the matched terminator', () => {
    const machine = createWedgeMachine();
    const { final, suppressedDuringText } = feed(machine, '1:04:SN-TEST-8', 20);
    expect(suppressedDuringText).toBe(0);
    expect(final.suppress).toBe(true);
  });

  it('survives slow scanner pacing (150ms keys — Bluetooth HID)', () => {
    const machine = createWedgeMachine();
    const { final } = feed(machine, '1:04:SN-TEST-8', 150);
    expect(final.emit).toBe('1:04:SN-TEST-8');
  });

  it('captures Shift-chorded streams (capitals and colons on a real scanner)', () => {
    const machine = createWedgeMachine();
    let t = 1000;
    for (const ch of '1:04:SN-TEST-8') {
      if (/[A-Z:]/.test(ch)) {
        machine.step(key('Shift', t));
        t += 5;
      }
      machine.step(key(ch, t));
      t += 20;
    }
    const final = machine.step(key('Enter', t));
    expect(final.emit).toBe('1:04:SN-TEST-8');
  });

  it('captures the code typed after unrelated text in the same field', () => {
    const machine = createWedgeMachine();
    const { final } = feed(machine, 'measured twice 1:04:SN-TEST-8', 80);
    expect(final.emit).toBe('1:04:SN-TEST-8');
    expect(final.consumedLength).toBe('1:04:SN-TEST-8'.length);
  });

  it('passes plain typing + Enter through untouched (form submits work)', () => {
    const machine = createWedgeMachine();
    const { final } = feed(machine, 'hello there', 120);
    expect(final.emit).toBeNull();
    expect(final.suppress).toBe(false);
  });

  it('a long pause between keys starts a new capture episode', () => {
    const machine = createWedgeMachine();
    machine.step(key('1', 1000));
    machine.step(key(':', 1100));
    // 2s stall — whatever was typed before no longer counts as one episode
    machine.step(key('9', 3100));
    const final = machine.step(key('Enter', 3200));
    expect(final.emit).toBeNull();
  });

  it('editing keys (Backspace, arrows, chords, repeats) restart the episode', () => {
    const machine = createWedgeMachine();
    for (const editKey of ['Backspace', 'ArrowLeft']) {
      feedPartial(machine, '1:04:SN-', 20, 1000);
      machine.step(key(editKey, 1400));
      feedPartial(machine, 'X', 20, 1500);
      expect(machine.step(key('Enter', 1600)).emit).toBeNull();
      machine.reset();
    }
    feedPartial(machine, '1:04:SN-TEST-8', 20, 5000);
    machine.step(key('c', 5400, { hasModifier: true })); // Cmd+C
    expect(machine.step(key('Enter', 5500)).emit).toBeNull();
  });

  it('rejects captures below minLength', () => {
    const machine = createWedgeMachine({ ...WEDGE_DEFAULTS, minLength: 20 });
    const { final } = feed(machine, '1:04:SN-1', 20);
    expect(final.emit).toBeNull();
    expect(final.suppress).toBe(false);
  });

  it('captures back-to-back scans independently', () => {
    const machine = createWedgeMachine();
    const first = feed(machine, '1:01:aaa-1', 20, 1000);
    const second = feed(machine, '1:02:bbb-2', 20, 60_000);
    expect(first.final.emit).toBe('1:01:aaa-1');
    expect(second.final.emit).toBe('1:02:bbb-2');
  });

  it('offers an auto-fire candidate for a suffix-less scanner burst', () => {
    // The DS2278 stream shape observed on the floor: 0-6ms keys, no Enter.
    const machine = createWedgeMachine();
    feedPartial(machine, '1:04:SN-TEST-8', 3, 1000);
    const pending = machine.pendingAutoFire();
    expect(pending).not.toBeNull();
    expect(pending!.code).toBe('1:04:SN-TEST-8');
    expect(pending!.consumedLength).toBe('1:04:SN-TEST-8'.length);
  });

  it('never offers auto-fire for hand-typed codes (human key speed)', () => {
    const machine = createWedgeMachine();
    feedPartial(machine, '1:04:SN-TEST-8', 150, 1000);
    expect(machine.pendingAutoFire()).toBeNull();
  });

  it('never offers auto-fire without a full code tail', () => {
    const machine = createWedgeMachine();
    feedPartial(machine, '1:04:', 3, 1000);
    expect(machine.pendingAutoFire()).toBeNull();
  });

  it('honors a custom key gap limit', () => {
    const machine = createWedgeMachine({ ...WEDGE_DEFAULTS, maxKeyGapMs: 100 });
    const { final } = feed(machine, '1:04:SN-TEST-8', 150);
    expect(final.emit).toBeNull(); // every key lands in its own episode
  });
});

function feedPartial(
  machine: ReturnType<typeof createWedgeMachine>,
  text: string,
  intervalMs: number,
  startMs: number,
): void {
  let t = startMs;
  for (const ch of text) {
    machine.step(key(ch, t));
    t += intervalMs;
  }
}
