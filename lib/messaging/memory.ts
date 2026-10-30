/**
 * Messaging in memory, for tests and single-process development. Pub/sub fans
 * out to every matching subscriber. Streams keep each message until it ages
 * out, and deliver to each consumer one at a time in order; a nak'd message
 * comes back after its delay while later messages go on, as JetStream does.
 */

import type {
  ConsumerSpec, Delivery, LTConsumeOptions, LTMessage, LTMessagingProvider, LTPubSub,
  LTStreamMessage, LTStreams, LTSubscription, StreamSpec, Subject,
} from '../../types/messaging';
import { DELIVERY, START_AT } from './constants';
import { subjectMatches } from './subjects';

const DEFAULT_NAK_DELAY_MS = 1_000;

interface Stored { seq: number; subject: Subject; payload: string; at: number }

interface ConsumerState {
  spec: ConsumerSpec;
  /** Messages at or below this sequence were settled or skipped. */
  floor: number;
  settled: Set<number>;
  deliveries: Map<number, number>;
  retryAt: Map<number, number>;
}

interface StreamState { spec: StreamSpec; messages: Stored[]; seq: number; consumers: Map<string, ConsumerState>; wake: Set<() => void> }

class MemoryPubSub implements LTPubSub {
  private subs = new Set<{ filter: Subject; handler: (m: LTMessage) => void }>();

  async publish(subject: Subject, payload: string): Promise<void> {
    for (const sub of [...this.subs]) if (subjectMatches(sub.filter, subject)) sub.handler({ subject, payload });
  }

  subscribe(filter: Subject, handler: (m: LTMessage) => void): LTSubscription {
    const sub = { filter, handler };
    this.subs.add(sub);
    return { close: async () => { this.subs.delete(sub); } };
  }
}

class MemoryStreams implements LTStreams {
  private streams = new Map<string, StreamState>();

  async ensureStream(spec: StreamSpec): Promise<void> {
    const existing = this.streams.get(spec.name);
    if (existing) existing.spec = spec;
    else this.streams.set(spec.name, { spec, messages: [], seq: 0, consumers: new Map(), wake: new Set() });
  }

  async ensureConsumer(stream: string, spec: ConsumerSpec): Promise<void> {
    const s = this.stream(stream);
    const existing = s.consumers.get(spec.name);
    if (existing) {
      existing.spec = { ...existing.spec, filterSubjects: spec.filterSubjects };
      return;
    }
    const floor = (spec.startAt ?? START_AT.NEW) === START_AT.ALL ? 0 : s.seq;
    s.consumers.set(spec.name, { spec, floor, settled: new Set(), deliveries: new Map(), retryAt: new Map() });
  }

  async append(subject: Subject, payload: string): Promise<void> {
    const now = Date.now();
    for (const s of this.streams.values()) {
      if (!s.spec.subjects.some((f) => subjectMatches(f, subject))) continue;
      s.messages.push({ seq: ++s.seq, subject, payload, at: now });
      s.messages = s.messages.filter((m) => now - m.at <= s.spec.maxAgeMs);
      for (const wake of [...s.wake]) wake();
    }
  }

  async consume(
    stream: string, consumer: string, handler: (m: LTStreamMessage) => Promise<Delivery>, opts: LTConsumeOptions = {},
  ): Promise<LTSubscription> {
    const s = this.stream(stream);
    const c = s.consumers.get(consumer);
    if (!c) throw new Error(`stream ${stream} has no consumer ${consumer}; ensure it first`);
    const nakDelayMs = opts.nakDelayMs ?? DEFAULT_NAK_DELAY_MS;
    let open = true;
    let running = false;
    let timer: NodeJS.Timeout | undefined;

    const next = (): { message?: Stored; waitMs?: number } => {
      const now = Date.now();
      let waitMs: number | undefined;
      for (const m of s.messages) {
        if (m.seq <= c.floor || c.settled.has(m.seq)) continue;
        if (!c.spec.filterSubjects.some((f) => subjectMatches(f, m.subject))) continue;
        const at = c.retryAt.get(m.seq);
        if (at === undefined || at <= now) return { message: m };
        waitMs = Math.min(waitMs ?? Infinity, at - now);
      }
      return { waitMs };
    };

    const pump = async (): Promise<void> => {
      if (running || !open) return;
      running = true;
      try {
        for (let step = next(); open && step.message; step = next()) {
          const m = step.message;
          const deliveries = (c.deliveries.get(m.seq) ?? 0) + 1;
          c.deliveries.set(m.seq, deliveries);
          const outcome = await handler({ subject: m.subject, payload: m.payload, deliveries }).catch(() => DELIVERY.NAK);
          if (outcome === DELIVERY.NAK) {
            c.retryAt.set(m.seq, Date.now() + nakDelayMs);
          } else {
            c.settled.add(m.seq);
            c.retryAt.delete(m.seq);
          }
        }
        const { waitMs } = next();
        if (open && waitMs !== undefined) {
          clearTimeout(timer);
          timer = setTimeout(() => void pump(), Math.max(0, waitMs));
        }
      } finally {
        running = false;
      }
    };

    const wake = () => void pump();
    s.wake.add(wake);
    void pump();
    return {
      close: async () => {
        open = false;
        clearTimeout(timer);
        s.wake.delete(wake);
      },
    };
  }

  private stream(name: string): StreamState {
    const s = this.streams.get(name);
    if (!s) throw new Error(`no stream ${name}; ensure it first`);
    return s;
  }
}

export class MemoryMessagingProvider implements LTMessagingProvider {
  readonly name = 'memory';
  readonly pubsub: LTPubSub = new MemoryPubSub();
  readonly streams: LTStreams = new MemoryStreams();
  private live = false;

  get connected(): boolean {
    return this.live;
  }

  async connect(): Promise<void> {
    this.live = true;
  }

  async disconnect(): Promise<void> {
    this.live = false;
  }
}
