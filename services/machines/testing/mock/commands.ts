/**
 * Commands: one at a time in arrival order, deduped by cmdId, discarded past
 * their expiry, replied on .../cmd/reply. A repeated cmdId gets the first
 * reply again and is never run twice.
 */

import { OP, REPLY_STATUS, type Envelope } from '../../../../lib/machines/protocol';
import type { Reply } from './cell';
import type { MockMachine } from './machine';

export const REPLY_MODE = { NORMAL: 'normal', DROP: 'drop' } as const;
export type ReplyMode = typeof REPLY_MODE[keyof typeof REPLY_MODE];

export class CommandHandler {
  private done = new Map<string, Reply>();
  replyMode: ReplyMode = REPLY_MODE.NORMAL;
  replyDelayMs = 0;
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly m: MockMachine) {}

  handle(env: Envelope | null): Promise<void> {
    const next = this.queue.then(() => this.handleOne(env));
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async handleOne(env: Envelope | null): Promise<void> {
    const body = env?.body as Record<string, any> | undefined;
    const cmdId = body?.cmdId;
    if (!body || typeof cmdId !== 'string') return;
    const prior = this.done.get(cmdId);
    if (prior) return this.reply(cmdId, { status: prior.status, reason: `${prior.reason} (repeat)` });
    const outcome = await this.run(body.op, body.args ?? {});
    this.done.set(cmdId, outcome);
    await this.reply(cmdId, outcome);
  }

  private async run(op: string, a: Record<string, any>): Promise<Reply> {
    if (a.expiresAt && Date.parse(a.expiresAt) < Date.now()) {
      return { status: REPLY_STATUS.REFUSED, reason: `expired at ${a.expiresAt}` };
    }
    switch (op) {
      case OP.DISPATCH:
        return this.m.cell.dispatch(a);
      case OP.CANCEL:
        return this.m.cell.cancel(a.jobId);
      case OP.ENABLE:
        await this.m.enable(true);
        return { status: REPLY_STATUS.ACCEPTED, reason: 'enabled' };
      case OP.DISABLE:
        await this.m.enable(false);
        return { status: REPLY_STATUS.ACCEPTED, reason: 'finishing the current unit; queue kept' };
      case OP.ACKNOWLEDGE_ALARM: {
        const ok = await this.m.alarms.acknowledge(a.alarmId, a.by ?? 'line-controller');
        return ok
          ? { status: REPLY_STATUS.ACCEPTED, reason: `acknowledged ${a.alarmId}` }
          : { status: REPLY_STATUS.REFUSED, reason: `no active alarm ${a.alarmId}` };
      }
      case OP.SNAPSHOT:
        await this.m.publishSnapshot();
        return { status: REPLY_STATUS.ACCEPTED, reason: 'snapshot published' };
      default:
        return { status: REPLY_STATUS.REFUSED, reason: `unknown op ${op}` };
    }
  }

  private async reply(cmdId: string, outcome: Reply): Promise<void> {
    if (this.replyMode === REPLY_MODE.DROP) return;
    const send = () => this.m.publishReply({ cmdId, status: outcome.status, reason: outcome.reason });
    if (this.replyDelayMs > 0) this.m.timers.after(this.replyDelayMs, () => void send());
    else await send();
  }
}
