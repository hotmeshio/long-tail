import { describe, it, expect } from 'vitest';

import { ReplyWaiter } from '../../../services/machines/gateway/reply-waiter';

const reply = (cmdId: string, status = 'accepted', extra: Record<string, unknown> = {}) => ({ cmdId, status, reason: status, ...extra });

describe('ReplyWaiter', () => {
  it('gives a reply to its waiter, and null at the deadline', async () => {
    const replies = new ReplyWaiter();
    const waiting = replies.wait('c1', 1_000);
    expect(replies.settle(reply('c1'))).toBe(true);
    expect(await waiting).toMatchObject({ cmdId: 'c1', status: 'accepted' });
    expect(await replies.wait('c2', 10)).toBeNull();
  });

  it('settles every wait on one command id with the next reply', async () => {
    const replies = new ReplyWaiter();
    const both = Promise.all([replies.wait('c1', 1_000), replies.wait('c1', 1_000)]);
    replies.settle(reply('c1'));
    expect((await both).map((r) => r?.cmdId)).toEqual(['c1', 'c1']);
  });

  it('keeps a final reply that came before its wait, for the final wait only', async () => {
    const replies = new ReplyWaiter();
    expect(replies.settle(reply('c1', 'completed', { data: { now: 9 } }))).toBe(false);
    expect(await replies.waitFinal('c1', 10)).toMatchObject({ status: 'completed', data: { now: 9 } });
    expect(await replies.waitFinal('c1', 10)).toBeNull();
  });

  it('does not take a kept preparing reply as the final one', async () => {
    const replies = new ReplyWaiter();
    replies.settle(reply('c1', 'accepted', { preparing: true }));
    const waiting = replies.waitFinal('c1', 1_000);
    replies.settle(reply('c1', 'failed'));
    expect(await waiting).toMatchObject({ status: 'failed' });
  });

  it('resolves every wait with null when cancelled, and forgets kept replies', async () => {
    const replies = new ReplyWaiter();
    replies.settle(reply('c9', 'completed'));
    const waiting = replies.wait('c1', 1_000);
    const snapshot = replies.waitSnapshot('press-01', 1_000);
    replies.cancelAll();
    expect(await waiting).toBeNull();
    expect(await snapshot).toBeNull();
    expect(await replies.waitFinal('c9', 10)).toBeNull();
  });
});
