/**
 * Command replies by cmdId. A wait registers before the command is published
 * and resolves with the reply, or null at the deadline.
 */

export interface CommandReply {
  cmdId: string;
  status: string;
  reason: string;
}

export class ReplyWaiter {
  private waiting = new Map<string, { resolve: (reply: CommandReply | null) => void; timer: NodeJS.Timeout }>();

  wait(cmdId: string, timeoutMs: number): Promise<CommandReply | null> {
    this.waiting.get(cmdId)?.resolve(null);
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.waiting.delete(cmdId);
        resolve(null);
      }, timeoutMs);
      this.waiting.set(cmdId, { resolve, timer });
    });
  }

  /** True when a waiter took the reply. */
  settle(reply: CommandReply): boolean {
    const w = this.waiting.get(reply.cmdId);
    if (!w) return false;
    clearTimeout(w.timer);
    this.waiting.delete(reply.cmdId);
    w.resolve(reply);
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
