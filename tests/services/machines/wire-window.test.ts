import { describe, it, expect } from 'vitest';

import { MAX_WIRE_PAGE, WireWindow, isWireDirection, isWireKind } from '../../../services/machines/gateway/wire-window';
import type { WireEvent } from '../../../types/machines-view';

function event(n: number, extra: Partial<WireEvent> = {}): WireEvent {
  return {
    type: 'machine.wire', siteId: 's', lineId: 'l', machineId: 'press-01', address: 'press-01', direction: 'in', channel: 'job', topic: 't',
    id: String(n), at: new Date(Date.UTC(2026, 0, 1, 0, 0, n)).toISOString(), retained: false, kind: 'job', event: 'arrived', summary: `e${n}`, violations: [], actions: [],
    ...extra,
  };
}

describe('the wire window', () => {
  it('keeps the last N events and reads them newest first', () => {
    const w = new WireWindow(3);
    for (let n = 1; n <= 5; n++) w.push(event(n));
    expect(w.length).toBe(3);
    expect(w.read().map((e) => e.id)).toEqual(['5', '4', '3']);
    expect(w.read({ limit: 2 }).map((e) => e.id)).toEqual(['5', '4']);
  });

  it('narrows by machine, direction, kind and time', () => {
    const w = new WireWindow(10);
    w.push(event(1));
    w.push(event(2, { machineId: 'cut-01', direction: 'out', kind: 'cmd' }));
    w.push(event(3, { kind: 'alarm' }));
    expect(w.read({ machine: 'cut-01' }).map((e) => e.id)).toEqual(['2']);
    expect(w.read({ direction: 'out' }).map((e) => e.id)).toEqual(['2']);
    expect(w.read({ kind: 'job' }).map((e) => e.id)).toEqual(['1']);
    expect(w.read({ since: event(1).at }).map((e) => e.id)).toEqual(['3', '2']);
  });

  it('caps a page and refuses a window that keeps nothing', () => {
    const w = new WireWindow(MAX_WIRE_PAGE + 5);
    for (let n = 1; n <= MAX_WIRE_PAGE + 5; n++) w.push(event(n));
    expect(w.read({ limit: 10_000 })).toHaveLength(MAX_WIRE_PAGE);
    expect(w.read({ limit: 0 })).toHaveLength(1);
    expect(() => new WireWindow(0)).toThrow(/at least one/);
  });

  it('knows the directions and kinds a query may name', () => {
    expect(isWireDirection('in') && isWireDirection('out')).toBe(true);
    expect(isWireDirection('sideways')).toBe(false);
    expect(isWireKind('cmd') && isWireKind('receipt')).toBe(true);
    expect(isWireKind('message')).toBe(false);
  });
});
