/**
 * Command replies by cmdId, and machine snapshots by machine. A wait registers
 * before the command is published and resolves with the reply, or null at the
 * deadline. Several waits on one key are all settled by the next answer, so
 * two dispatches asking one machine what it holds share its next snapshot.
 * A reply nobody waits for is kept a while, so a final reply that comes just
 * before its command row starts waiting for it is still read.
 */

export interface CommandReply {
  cmdId: string;
  status: string;
  reason: string;
  /** The machine's structured code for the outcome, when its reply carried one. */
  code?: string;
  /** An acceptance the machine will follow with `completed` or `failed` under the same cmdId. */
  preparing?: boolean;
  /** What the machine returned with the reply, such as a value it read. */
  data?: Record<string, unknown>;
}

/** The jobs a machine reports holding, queued or in work. */
export type HeldJobs = Set<string>;

interface Waiter<T> {
  resolve: (value: T | null) => void;
  timer: NodeJS.Timeout;
}

class Waits<T> {
  private waiting = new Map<string, Set<Waiter<T>>>();

  wait(key: string, timeoutMs: number): Promise<T | null> {
    return new Promise((resolve) => {
      const waiter: Waiter<T> = {
        resolve,
        timer: setTimeout(() => {
          this.drop(key, waiter);
          resolve(null);
        }, timeoutMs),
      };
      let waiters = this.waiting.get(key);
      if (!waiters) {
        waiters = new Set();
        this.waiting.set(key, waiters);
      }
      waiters.add(waiter);
    });
  }

  /** True when at least one waiter took the value. */
  settle(key: string, value: T | null): boolean {
    const waiters = this.waiting.get(key);
    if (!waiters) return false;
    this.waiting.delete(key);
    for (const w of waiters) {
      clearTimeout(w.timer);
      w.resolve(value);
    }
    return true;
  }

  cancelAll(): void {
    for (const waiters of this.waiting.values()) {
      for (const w of waiters) {
        clearTimeout(w.timer);
        w.resolve(null);
      }
    }
    this.waiting.clear();
  }

  private drop(key: string, waiter: Waiter<T>): void {
    const waiters = this.waiting.get(key);
    if (!waiters) return;
    waiters.delete(waiter);
    if (!waiters.size) this.waiting.delete(key);
  }
}

/** Replies nobody waited for, kept for a final-reply wait; the oldest are forgotten first. */
const UNCLAIMED_KEPT = 1_000;

export class ReplyWaiter {
  private replies = new Waits<CommandReply>();
  private snapshots = new Waits<HeldJobs>();
  private unclaimed = new Map<string, CommandReply>();

  wait(cmdId: string, timeoutMs: number): Promise<CommandReply | null> {
    return this.replies.wait(cmdId, timeoutMs);
  }

  /** The reply that settles a `preparing` one: kept already when it came first, else the next under `cmdId`. */
  waitFinal(cmdId: string, timeoutMs: number): Promise<CommandReply | null> {
    const kept = this.unclaimed.get(cmdId);
    this.unclaimed.delete(cmdId);
    if (kept && !kept.preparing) return Promise.resolve(kept);
    return this.replies.wait(cmdId, timeoutMs);
  }

  /** True when a waiter took the reply. */
  settle(reply: CommandReply): boolean {
    if (this.replies.settle(reply.cmdId, reply)) return true;
    this.unclaimed.delete(reply.cmdId);
    this.unclaimed.set(reply.cmdId, reply);
    if (this.unclaimed.size > UNCLAIMED_KEPT) this.unclaimed.delete(this.unclaimed.keys().next().value!);
    return false;
  }

  /** The next snapshot from `machineId`, or null at the deadline; every wait in flight for the machine gets it. */
  waitSnapshot(machineId: string, timeoutMs: number): Promise<HeldJobs | null> {
    return this.snapshots.wait(machineId, timeoutMs);
  }

  /** Answer the status queries in flight; null when there is nothing to wait for. */
  settleSnapshot(machineId: string, jobs: HeldJobs | null): void {
    this.snapshots.settle(machineId, jobs);
  }

  cancelAll(): void {
    this.replies.cancelAll();
    this.snapshots.cancelAll();
    this.unclaimed.clear();
  }
}
