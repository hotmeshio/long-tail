import { describe, it, expect, afterEach } from 'vitest';

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
});
