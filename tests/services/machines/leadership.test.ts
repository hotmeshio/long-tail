import { describe, it, expect, afterEach } from 'vitest';

import { getPool } from '../../../lib/db';
import { LineLeadership } from '../../../services/machines/leadership';
import { sleep, until } from '../../../services/machines/testing/wait';

const held: LineLeadership[] = [];
afterEach(async () => {
  for (const l of held.splice(0)) await l.stop();
});

function contender(key: string, log: string[], name: string): LineLeadership {
  const l = new LineLeadership(key);
  held.push(l);
  void l.run(async () => { log.push(name); }, async () => undefined);
  return l;
}

describe('line leadership', () => {
  it('lets one replica lead a line while another waits, and hands over when the leader stops', async () => {
    const key = `test-line-${Date.now()}`;
    const log: string[] = [];
    const first = contender(key, log, 'first');
    await until(() => log.length === 1, 5_000);
    contender(key, log, 'second');
    await sleep(300);
    expect(log).toEqual(['first']);
    await first.stop();
    await until(() => log.length === 2, 5_000);
    expect(log).toEqual(['first', 'second']);
  });

  it('a replica still waiting stops at once', async () => {
    const key = `test-line-wait-${Date.now()}`;
    const log: string[] = [];
    contender(key, log, 'leader');
    await until(() => log.length === 1, 5_000);
    const waiting = contender(key, log, 'waiting');
    await sleep(100);
    const started = Date.now();
    await waiting.stop();
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(log).toEqual(['leader']);
  });

  it('leads different lines at the same time', async () => {
    const log: string[] = [];
    contender(`test-line-a-${Date.now()}`, log, 'a');
    contender(`test-line-b-${Date.now()}`, log, 'b');
    await until(() => log.length === 2, 5_000);
    expect(log.sort()).toEqual(['a', 'b']);
  });

  it('contends again when the database refuses the connection, as while it recovers', async () => {
    let refusals = 2;
    const lost: string[] = [];
    const log: string[] = [];
    const l = new LineLeadership(`test-line-refused-${Date.now()}`, {
      retryMs: 10,
      connect: async () => {
        if (refusals-- > 0) throw new Error('the database system is not yet accepting connections');
        return getPool().connect();
      },
    });
    held.push(l);
    void l.run(async () => { log.push('leading'); }, async (err) => { lost.push(err.message); });
    await until(() => log.length === 1, 5_000);
    expect(lost).toEqual(['the database system is not yet accepting connections', 'the database system is not yet accepting connections']);
  });

  it('never leads when stopped while its connection was still opening', async () => {
    const log: string[] = [];
    const l = new LineLeadership(`test-line-stop-early-${Date.now()}`, {
      connect: async () => { await sleep(100); return getPool().connect(); },
    });
    void l.run(async () => { log.push('leading'); }, async () => undefined);
    await sleep(20);
    await l.stop();
    await sleep(250);
    expect(log).toEqual([]);
  });

  it('lets the lock go only after the lost leader has stopped', async () => {
    const key = `test-line-lost-${Date.now()}`;
    const log: string[] = [];
    let finishStopping!: () => void;
    const stopping = new Promise<void>((r) => { finishStopping = r; });
    const first = new LineLeadership(key, { retryMs: 60_000 });
    held.push(first);
    void first.run(async () => { log.push('first'); throw new Error('reconcile failed'); }, async () => { log.push('first stopping'); await stopping; });
    await until(() => log.includes('first stopping'), 5_000);
    contender(key, log, 'second');
    await sleep(300);
    expect(log).toEqual(['first', 'first stopping']);
    finishStopping();
    await until(() => log.includes('second'), 5_000);
  });
});
