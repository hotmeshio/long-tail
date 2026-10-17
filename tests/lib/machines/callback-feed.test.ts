import { describe, it, expect } from 'vitest';

import { CallbackEventAdapter } from '../../../lib/events/callback';
import { CallbackEscalationFeed, DISPOSITION } from '../../../lib/machines/transport';
import { sleep, until } from '../../../services/machines/testing/wait';

const created = (id: string) => ({
  type: `system.escalation.line-trim.${id}.created`, escalationId: id, role: 'line-trim', data: { id, role: 'line-trim' },
}) as any;

describe('in-process escalation feed', () => {
  it('hands escalation events to the gateway and ignores other families', async () => {
    const adapter = new CallbackEventAdapter();
    const feed = new CallbackEscalationFeed(adapter, 5);
    const seen: string[] = [];
    await feed.consume(async (e) => { seen.push(`${e.escalationId}:${e.verb}`); return DISPOSITION.ACK; });
    await adapter.publish(created('e1'));
    await adapter.publish({ type: 'task.created', data: {} } as any);
    await until(() => seen.length === 1);
    expect(seen).toEqual(['e1:created']);
    await feed.close();
  });

  it('tries an event again until its row is actionable', async () => {
    const adapter = new CallbackEventAdapter();
    const feed = new CallbackEscalationFeed(adapter, 5);
    let tries = 0;
    await feed.consume(async () => (++tries < 3 ? DISPOSITION.NAK : DISPOSITION.ACK));
    await adapter.publish(created('e2'));
    await until(() => tries === 3);
    await feed.close();
  });

  it('stops listening when closed', async () => {
    const adapter = new CallbackEventAdapter();
    const feed = new CallbackEscalationFeed(adapter, 5);
    let calls = 0;
    await feed.consume(async () => { calls++; return DISPOSITION.ACK; });
    await feed.close();
    await adapter.publish(created('e3'));
    await sleep(20);
    expect(calls).toBe(0);
  });
});
