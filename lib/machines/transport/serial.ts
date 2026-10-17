import { DISPOSITION, type Disposition } from './delivery';

/** Runs async work one item at a time, in arrival order. */
export class SerialQueue {
  private tail: Promise<unknown> = Promise.resolve();

  run<T>(work: () => Promise<T>): Promise<T> {
    const next = this.tail.then(work, work);
    this.tail = next.catch(() => undefined);
    return next;
  }

  /** Resolves once everything queued so far has run. */
  drained(): Promise<void> {
    return this.tail.then(() => undefined);
  }
}

/**
 * Delivery through a SerialQueue that tries a not-yet-actionable item again
 * after a delay, for transports without a broker-side redelivery.
 */
export class LocalRedelivery {
  private readonly timers = new Set<NodeJS.Timeout>();
  private stopped = false;

  constructor(readonly queue: SerialQueue, private readonly delayMs: number) {}

  deliver(attempt: (deliveries: number) => Promise<Disposition>, deliveries = 1): Promise<void> {
    return this.queue.run(async () => {
      if (this.stopped) return;
      const disposition = await attempt(deliveries).catch(() => DISPOSITION.NAK);
      if (disposition !== DISPOSITION.NAK) return;
      const timer = setTimeout(() => {
        this.timers.delete(timer);
        void this.deliver(attempt, deliveries + 1);
      }, this.delayMs);
      this.timers.add(timer);
    });
  }

  async stop(): Promise<void> {
    this.stopped = true;
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    await this.queue.drained();
  }
}
