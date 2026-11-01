import { useCallback, useEffect, useMemo, useReducer } from 'react';
import { useEventSubscription } from './useEventContext';
import {
  machineWirePattern,
  WIRE_EVENT_TYPE,
  WIRE_KINDS,
  type WireDirection,
  type WireEvent,
  type WireKind,
} from '../api/machines';

/** The tape keeps this many events, newest first; older ones fall off the end. */
export const WIRE_TAPE_CAPACITY = 2000;

export interface WireTapeFilters {
  machine: string | null;
  channel: string | null;
  direction: WireDirection | null;
  kind: WireKind | null;
  violationsOnly: boolean;
}

export interface WireTapeState {
  /** Newest first. */
  events: WireEvent[];
  /** Events that arrived while paused, newest first; they join the tape on resume. */
  held: WireEvent[];
  paused: boolean;
  filters: WireTapeFilters;
}

export type WireTapeAction =
  | { type: 'ingest'; event: WireEvent }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'clear' }
  | { type: 'filter'; patch: Partial<WireTapeFilters> };

export const EMPTY_FILTERS: WireTapeFilters = {
  machine: null,
  channel: null,
  direction: null,
  kind: null,
  violationsOnly: false,
};

export function initialTapeState(): WireTapeState {
  return { events: [], held: [], paused: false, filters: EMPTY_FILTERS };
}

function cap(events: WireEvent[]): WireEvent[] {
  return events.length > WIRE_TAPE_CAPACITY ? events.slice(0, WIRE_TAPE_CAPACITY) : events;
}

export function wireTapeReducer(state: WireTapeState, action: WireTapeAction): WireTapeState {
  switch (action.type) {
    case 'ingest':
      return state.paused
        ? { ...state, held: cap([action.event, ...state.held]) }
        : { ...state, events: cap([action.event, ...state.events]) };
    case 'pause':
      return state.paused ? state : { ...state, paused: true };
    case 'resume':
      return { ...state, paused: false, held: [], events: cap([...state.held, ...state.events]) };
    case 'clear':
      return { ...state, events: [], held: [] };
    case 'filter':
      return { ...state, filters: { ...state.filters, ...action.patch } };
  }
}

export function matchesFilters(event: WireEvent, filters: WireTapeFilters): boolean {
  if (filters.machine && event.machineId !== filters.machine) return false;
  if (filters.channel && event.channel !== filters.channel) return false;
  if (filters.direction && event.direction !== filters.direction) return false;
  if (filters.kind && event.kind !== filters.kind) return false;
  if (filters.violationsOnly && event.violations.length === 0) return false;
  return true;
}

export function applyFilters(events: WireEvent[], filters: WireTapeFilters): WireEvent[] {
  return events.filter((event) => matchesFilters(event, filters));
}

const KINDS = new Set<string>(WIRE_KINDS);

/**
 * The transport hands over the published event envelope: its routing type
 * carries the site, line, machine and direction tokens after `machine.wire`,
 * and the wire event itself rides in `data`. A bare wire event is read as is.
 */
export function toWireEvent(raw: unknown): WireEvent | null {
  if (!raw || typeof raw !== 'object') return null;
  const envelope = raw as Record<string, unknown>;
  const type = envelope.type;
  if (typeof type !== 'string' || (type !== WIRE_EVENT_TYPE && !type.startsWith(`${WIRE_EVENT_TYPE}.`))) {
    return null;
  }
  const e = envelope.data && typeof envelope.data === 'object' ? (envelope.data as Record<string, unknown>) : envelope;
  if (typeof e.siteId !== 'string' || typeof e.lineId !== 'string') return null;
  if (e.direction !== 'in' && e.direction !== 'out') return null;
  const kind = typeof e.kind === 'string' && KINDS.has(e.kind) ? (e.kind as WireKind) : 'unknown';
  const at = [e.at, envelope.timestamp].find((v): v is string => typeof v === 'string') ?? new Date().toISOString();
  return {
    type: WIRE_EVENT_TYPE,
    siteId: e.siteId,
    lineId: e.lineId,
    machineId: typeof e.machineId === 'string' ? e.machineId : null,
    address: typeof e.address === 'string' ? e.address : null,
    direction: e.direction,
    channel: typeof e.channel === 'string' ? e.channel : '',
    topic: typeof e.topic === 'string' ? e.topic : '',
    id: typeof e.id === 'string' ? e.id : null,
    at,
    retained: e.retained === true,
    kind,
    event: typeof e.event === 'string' ? e.event : null,
    summary: typeof e.summary === 'string' ? e.summary : '',
    violations: Array.isArray(e.violations) ? e.violations.filter((v): v is string => typeof v === 'string') : [],
    actions: Array.isArray(e.actions) ? (e.actions as WireEvent['actions']) : [],
    ...('payload' in e ? { payload: e.payload } : {}),
  };
}

function distinct(values: (string | null)[]): string[] {
  return [...new Set(values.filter((v): v is string => !!v))].sort();
}

/**
 * The live tape of one line's wire events: a bounded ring buffer fed by the
 * event transport, with filters and a pause that holds new arrivals aside.
 */
export function useWireTape(siteId: string, lineId: string) {
  const [state, dispatch] = useReducer(wireTapeReducer, undefined, initialTapeState);

  useEffect(() => {
    dispatch({ type: 'clear' });
  }, [siteId, lineId]);

  useEventSubscription(machineWirePattern(siteId, lineId), (raw) => {
    const event = toWireEvent(raw);
    if (event) dispatch({ type: 'ingest', event });
  });

  const visible = useMemo(() => applyFilters(state.events, state.filters), [state.events, state.filters]);
  const machines = useMemo(() => distinct(state.events.map((e) => e.machineId)), [state.events]);
  const channels = useMemo(() => distinct(state.events.map((e) => e.channel)), [state.events]);

  const setFilter = useCallback((patch: Partial<WireTapeFilters>) => dispatch({ type: 'filter', patch }), []);
  const togglePause = useCallback(() => dispatch({ type: state.paused ? 'resume' : 'pause' }), [state.paused]);
  const clear = useCallback(() => dispatch({ type: 'clear' }), []);

  return {
    events: visible,
    total: state.events.length,
    heldCount: state.held.length,
    paused: state.paused,
    filters: state.filters,
    machines,
    channels,
    setFilter,
    togglePause,
    clear,
  };
}
