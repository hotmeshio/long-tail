/**
 * Command replies by cmdId, and machine snapshots by machine. A wait registers
 * before the command is published and resolves with the reply, or null at the
 * deadline.
 */

export interface CommandReply {
  cmdId: string;
  status: string;
  reason: string;
}

/** The jobs a machine reports holding, queued or in work. */
export type HeldJobs = Set<string>;

class Waits<T> {
  private waiting = new Map<string, { resolve: (value: T | null) => void; timer: NodeJS.Timeout }>();

  wait(key: string, timeoutMs: number): Promise<T | null> {
    this.waiting.get(key)?.resolve(null);
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.waiting.delete(key);
        resolve(null);
      }, timeoutMs);
      this.waiting.set(key, { resolve, timer });
    });
  }

  settle(key: string, value: T | null): boolean {
    const w = this.waiting.get(key);
    if (!w) return false;
    clearTimeout(w.timer);
    this.waiting.delete(key);
    w.resolve(value);
    return true;
  }

  cancelAll(): void {
    for (const [, w] of this.waiting) {
      clearTimeout(w.timer);
      w.resolve(null);
    }
    this.waiting.clear();
  }
}

export class ReplyWaiter {
  private replies = new Waits<CommandReply>();
  private snapshots = new Waits<HeldJobs>();

  wait(cmdId: string, timeoutMs: number): Promise<CommandReply | null> {
    return this.replies.wait(cmdId, timeoutMs);
  }

  /** True when a waiter took the reply. */
  settle(reply: CommandReply): boolean {
    return this.replies.settle(reply.cmdId, reply);
  }

  /** The next snapshot from `machineId`, or null at the deadline. */
  waitSnapshot(machineId: string, timeoutMs: number): Promise<HeldJobs | null> {
    return this.snapshots.wait(machineId, timeoutMs);
  }

  /** Answer a status query in flight; null when there is nothing to wait for. */
  settleSnapshot(machineId: string, jobs: HeldJobs | null): void {
    this.snapshots.settle(machineId, jobs);
  }

  cancelAll(): void {
    this.replies.cancelAll();
    this.snapshots.cancelAll();
  }
}
