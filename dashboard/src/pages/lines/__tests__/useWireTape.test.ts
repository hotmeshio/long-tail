import { describe, it, expect } from 'vitest';
import {
  applyFilters,
  EMPTY_FILTERS,
  initialTapeState,
  toWireEvent,
  WIRE_TAPE_CAPACITY,
  wireTapeReducer,
  type WireTapeState,
} from '../../../hooks/useWireTape';
import type { WireEvent } from '../../../api/machines';

function makeEvent(overrides: Partial<WireEvent> = {}): WireEvent {
  return {
    type: 'machine.wire',
    siteId: 'acme',
    lineId: 'l1',
    machineId: 'm1',
    address: 'addr-1',
    direction: 'in',
    channel: 'job',
    topic: 'acme/l1/m1/job',
    id: null,
    at: '2026-10-31T10:00:00.000Z',
    retained: false,
    kind: 'job',
    event: 'arrived',
    summary: 'job arrived U1',
    violations: [],
    actions: [],
    ...overrides,
  };
}

function ingest(state: WireTapeState, event: WireEvent): WireTapeState {
  return wireTapeReducer(state, { type: 'ingest', event });
}

describe('wireTapeReducer', () => {
  it('keeps the newest event first', () => {
    let state = initialTapeState();
    state = ingest(state, makeEvent({ id: 'a' }));
    state = ingest(state, makeEvent({ id: 'b' }));
    expect(state.events.map((e) => e.id)).toEqual(['b', 'a']);
  });

  it('caps the ring buffer at the capacity, dropping the oldest', () => {
    let state = initialTapeState();
    for (let i = 0; i < WIRE_TAPE_CAPACITY + 5; i++) {
      state = ingest(state, makeEvent({ id: String(i) }));
    }
    expect(state.events).toHaveLength(WIRE_TAPE_CAPACITY);
    expect(state.events[0].id).toBe(String(WIRE_TAPE_CAPACITY + 4));
    expect(state.events[WIRE_TAPE_CAPACITY - 1].id).toBe('5');
  });

  it('holds arrivals aside while paused and merges them on resume', () => {
    let state = ingest(initialTapeState(), makeEvent({ id: 'a' }));
    state = wireTapeReducer(state, { type: 'pause' });
    state = ingest(state, makeEvent({ id: 'b' }));
    state = ingest(state, makeEvent({ id: 'c' }));
    expect(state.events.map((e) => e.id)).toEqual(['a']);
    expect(state.held.map((e) => e.id)).toEqual(['c', 'b']);
    state = wireTapeReducer(state, { type: 'resume' });
    expect(state.paused).toBe(false);
    expect(state.held).toEqual([]);
    expect(state.events.map((e) => e.id)).toEqual(['c', 'b', 'a']);
  });

  it('clears both the tape and the held events', () => {
    let state = ingest(initialTapeState(), makeEvent());
    state = wireTapeReducer(state, { type: 'pause' });
    state = ingest(state, makeEvent());
    state = wireTapeReducer(state, { type: 'clear' });
    expect(state.events).toEqual([]);
    expect(state.held).toEqual([]);
  });

  it('patches filters without touching the events', () => {
    let state = ingest(initialTapeState(), makeEvent());
    state = wireTapeReducer(state, { type: 'filter', patch: { machine: 'm2', violationsOnly: true } });
    expect(state.filters).toEqual({ ...EMPTY_FILTERS, machine: 'm2', violationsOnly: true });
    expect(state.events).toHaveLength(1);
  });
});

describe('applyFilters', () => {
  const events = [
    makeEvent({ id: '1', machineId: 'm1', channel: 'job', direction: 'in', kind: 'job' }),
    makeEvent({ id: '2', machineId: 'm2', channel: 'cmd', direction: 'out', kind: 'cmd', violations: ['bad op'] }),
    makeEvent({ id: '3', machineId: 'm1', channel: 'alarm', direction: 'in', kind: 'alarm', violations: ['level'] }),
  ];

  it('filters by machine, channel, direction and kind', () => {
    expect(applyFilters(events, { ...EMPTY_FILTERS, machine: 'm1' }).map((e) => e.id)).toEqual(['1', '3']);
    expect(applyFilters(events, { ...EMPTY_FILTERS, channel: 'cmd' }).map((e) => e.id)).toEqual(['2']);
    expect(applyFilters(events, { ...EMPTY_FILTERS, direction: 'in' }).map((e) => e.id)).toEqual(['1', '3']);
    expect(applyFilters(events, { ...EMPTY_FILTERS, kind: 'alarm' }).map((e) => e.id)).toEqual(['3']);
  });

  it('keeps only events with violations when asked', () => {
    expect(applyFilters(events, { ...EMPTY_FILTERS, violationsOnly: true }).map((e) => e.id)).toEqual(['2', '3']);
  });

  it('ands the filters together', () => {
    expect(applyFilters(events, { ...EMPTY_FILTERS, machine: 'm1', violationsOnly: true }).map((e) => e.id)).toEqual(['3']);
  });
});

describe('toWireEvent', () => {
  it('accepts the routed type and normalizes it to machine.wire', () => {
    const event = toWireEvent({ ...makeEvent(), type: 'machine.wire.acme.l1.m1.in' });
    expect(event?.type).toBe('machine.wire');
    expect(event?.machineId).toBe('m1');
  });

  it('reads the wire event out of the published envelope', () => {
    const envelope = {
      type: 'machine.wire.acme.l1.m1.out',
      source: 'machine-gateway',
      timestamp: '2026-10-31T20:00:00.000Z',
      data: { ...makeEvent({ direction: 'out', at: undefined as unknown as string, payload: { op: 'snapshot' } }) },
    };
    const event = toWireEvent(envelope);
    expect(event?.direction).toBe('out');
    expect(event?.siteId).toBe('acme');
    expect(event?.at).toBe('2026-10-31T20:00:00.000Z');
    expect(event?.payload).toEqual({ op: 'snapshot' });
  });

  it('rejects events of another type', () => {
    expect(toWireEvent({ ...makeEvent(), type: 'system.escalation.r.id.created' })).toBeNull();
  });

  it('keeps the payload only when the server sent one', () => {
    expect('payload' in toWireEvent(makeEvent())!).toBe(false);
    expect(toWireEvent(makeEvent({ payload: { a: 1 } }))?.payload).toEqual({ a: 1 });
  });
});
