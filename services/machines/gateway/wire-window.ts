/**
 * The last wire events of a line, kept by its leader so a client reads the
 * tape over HTTP instead of the event stream. A ring of a fixed size; reads
 * are newest first and may narrow by machine, direction, kind and time.
 */

import type { WireDirection, WireEvent, WireKind, WireWindowQuery } from '../../../types/machines-view';

export const DEFAULT_WIRE_WINDOW = 500;
export const MAX_WIRE_PAGE = 500;

export class WireWindow {
  private readonly events: WireEvent[] = [];
  private head = 0;
  private count = 0;

  constructor(readonly size = DEFAULT_WIRE_WINDOW) {
    if (!Number.isInteger(size) || size < 1) throw new Error(`a wire window keeps at least one event (got ${size})`);
  }

  push(event: WireEvent): void {
    this.events[this.head] = event;
    this.head = (this.head + 1) % this.size;
    if (this.count < this.size) this.count += 1;
  }

  /** Newest first, narrowed by the query, at most `limit` (the window's size when absent). */
  read(query: WireWindowQuery = {}): WireEvent[] {
    const limit = Math.min(Math.max(1, query.limit ?? this.size), MAX_WIRE_PAGE);
    const out: WireEvent[] = [];
    for (let i = 1; i <= this.count && out.length < limit; i++) {
      const event = this.events[(this.head - i + this.size) % this.size];
      if (matches(event, query)) out.push(event);
    }
    return out;
  }

  get length(): number {
    return this.count;
  }
}

function matches(event: WireEvent, q: WireWindowQuery): boolean {
  if (q.machine && event.machineId !== q.machine) return false;
  if (q.direction && event.direction !== q.direction) return false;
  if (q.kind && event.kind !== q.kind) return false;
  if (q.since && event.at <= q.since) return false;
  return true;
}

export function isWireDirection(v: unknown): v is WireDirection {
  return v === 'in' || v === 'out';
}

const KINDS: readonly string[] = ['presence', 'snapshot', 'job', 'alarm', 'telemetry', 'report', 'cmd', 'reply', 'receipt', 'unknown'];

export function isWireKind(v: unknown): v is WireKind {
  return typeof v === 'string' && KINDS.includes(v);
}
