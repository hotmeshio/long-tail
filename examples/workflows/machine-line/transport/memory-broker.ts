/**
 * An in-process broker with the semantics the line relies on: retained
 * messages, wills, persistent sessions that queue QoS 1 messages while a
 * client is away, and a durable consumer log with ack, nak and replay (the
 * JetStream stand-in). Used by tests and single-process runs.
 */

import { DISPOSITION, topicMatches, type Disposition, type InboundMessage, type LinkWill } from './types';

interface Session {
  connected: boolean;
  will?: LinkWill;
  subs: Map<string, (msg: InboundMessage) => void>;
  queued: InboundMessage[];
}

interface Durable {
  filter: string;
  cursor: number;
  handler?: (msg: InboundMessage) => Promise<Disposition>;
  pumping: boolean;
  retries: Map<number, number>;
  timers: Set<NodeJS.Timeout>;
}

export interface MemoryBrokerOptions {
  /** Delay before a nak'd message is offered again. */
  redeliverMs?: number;
  maxDeliver?: number;
}

export class MemoryBroker {
  private sessions = new Map<string, Session>();
  private retainedStore = new Map<string, string>();
  private log: { seq: number; topic: string; payload: string; retained: boolean }[] = [];
  private durables = new Map<string, Durable>();
  private readonly redeliverMs: number;
  private readonly maxDeliver: number;

  constructor(opts: MemoryBrokerOptions = {}) {
    this.redeliverMs = opts.redeliverMs ?? 20;
    this.maxDeliver = opts.maxDeliver ?? 50;
  }

  connect(clientId: string, will?: LinkWill): void {
    const session: Session = this.sessions.get(clientId) ?? { connected: false, subs: new Map(), queued: [] };
    session.connected = true;
    session.will = will;
    this.sessions.set(clientId, session);
    const queued = session.queued.splice(0);
    for (const msg of queued) this.deliverToSession(session, msg);
  }

  disconnect(clientId: string, graceful: boolean): void {
    const session = this.sessions.get(clientId);
    if (!session?.connected) return;
    session.connected = false;
    const will = session.will;
    session.will = undefined;
    if (!graceful && will) this.publish(will.topic, will.payload, will.retain);
  }

  isConnected(clientId: string): boolean {
    return this.sessions.get(clientId)?.connected ?? false;
  }

  subscribe(clientId: string, filter: string, handler: (msg: InboundMessage) => void): void {
    const session = this.sessions.get(clientId);
    if (!session) throw new Error(`subscribe before connect: ${clientId}`);
    session.subs.set(filter, handler);
    for (const [topic, payload] of this.retainedStore) {
      if (topicMatches(filter, topic)) queueMicrotask(() => handler({ topic, payload, retained: true, deliveries: 1 }));
    }
  }

  publish(topic: string, payload: string, retain = false): void {
    if (retain) {
      if (payload === '') this.retainedStore.delete(topic);
      else this.retainedStore.set(topic, payload);
    }
    for (const session of this.sessions.values()) {
      this.deliverToSession(session, { topic, payload, retained: false, deliveries: 1 });
    }
    this.log.push({ seq: this.log.length, topic, payload, retained: retain });
    for (const durable of this.durables.values()) void this.pump(durable);
  }

  retained(filter: string): InboundMessage[] {
    return [...this.retainedStore]
      .filter(([topic]) => topicMatches(filter, topic))
      .map(([topic, payload]) => ({ topic, payload, retained: true, deliveries: 1 }));
  }

  /** Attach a handler to a named durable consumer; it resumes from its cursor. */
  consume(name: string, filter: string, handler: (msg: InboundMessage) => Promise<Disposition>): void {
    const durable: Durable = this.durables.get(name) ?? { filter, cursor: 0, pumping: false, retries: new Map(), timers: new Set() };
    durable.handler = handler;
    this.durables.set(name, durable);
    void this.pump(durable);
  }

  /** Detach the handler; unacked and unread messages wait for the next consume. */
  detach(name: string): void {
    const durable = this.durables.get(name);
    if (!durable) return;
    durable.handler = undefined;
    for (const t of durable.timers) clearTimeout(t);
    durable.timers.clear();
    if (durable.retries.size) durable.cursor = Math.min(durable.cursor, ...durable.retries.keys());
    durable.retries.clear();
  }

  shutdown(): void {
    for (const name of this.durables.keys()) this.detach(name);
  }

  private deliverToSession(session: Session, msg: InboundMessage): void {
    for (const [filter, handler] of session.subs) {
      if (!topicMatches(filter, msg.topic)) continue;
      if (session.connected) queueMicrotask(() => handler(msg));
      else session.queued.push(msg);
    }
  }

  private async pump(durable: Durable): Promise<void> {
    if (durable.pumping) return;
    durable.pumping = true;
    try {
      while (durable.handler && durable.cursor < this.log.length) {
        const entry = this.log[durable.cursor++];
        if (topicMatches(durable.filter, entry.topic)) await this.offer(durable, entry.seq);
      }
    } finally {
      durable.pumping = false;
    }
  }

  private async offer(durable: Durable, seq: number): Promise<void> {
    const handler = durable.handler;
    if (!handler) return;
    const entry = this.log[seq];
    const deliveries = (durable.retries.get(seq) ?? 0) + 1;
    durable.retries.set(seq, deliveries);
    let disposition: Disposition;
    try {
      disposition = await handler({ topic: entry.topic, payload: entry.payload, retained: entry.retained, deliveries });
    } catch {
      disposition = DISPOSITION.NAK;
    }
    if (disposition !== DISPOSITION.NAK || deliveries >= this.maxDeliver) {
      durable.retries.delete(seq);
      return;
    }
    const timer = setTimeout(() => {
      durable.timers.delete(timer);
      void this.offer(durable, seq);
    }, this.redeliverMs);
    durable.timers.add(timer);
  }
}
