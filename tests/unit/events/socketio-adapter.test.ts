import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../lib/logger', () => ({
  loggerRegistry: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { SocketIOEventAdapter } from '../../../lib/events/socketio';
import type { LTEvent } from '../../../types';

function makeSocket(patterns?: string[]) {
  return {
    data: { ltPatterns: patterns ? new Set(patterns) : new Set<string>() },
    emit: vi.fn(),
  };
}

function makeEvent(type: string): LTEvent {
  return { type, timestamp: '2026-07-25T00:00:00.000Z' };
}

/** Wire a fake io so publish() scoping is testable without a real server. */
function adapterWithSockets(sockets: ReturnType<typeof makeSocket>[]) {
  const adapter = new SocketIOEventAdapter();
  const map = new Map(sockets.map((s, i) => [`sock-${i}`, s]));
  (adapter as any).io = { of: () => ({ sockets: map }) };
  return adapter;
}

describe('SocketIOEventAdapter publish scoping', () => {
  let event: LTEvent;

  beforeEach(() => {
    event = makeEvent('system.escalation.order-review.esc-1.created');
  });

  it('a socket with no registered patterns receives every event', async () => {
    const socket = makeSocket();
    await adapterWithSockets([socket]).publish(event);
    expect(socket.emit).toHaveBeenCalledWith(
      'lt.events.system.escalation.order-review.esc-1.created',
      event,
    );
  });

  it('a scoped socket receives only matching subjects', async () => {
    const matching = makeSocket(['lt.events.system.escalation.order-review.>']);
    const other = makeSocket(['lt.events.system.escalation.other-role.>']);
    await adapterWithSockets([matching, other]).publish(event);
    expect(matching.emit).toHaveBeenCalledTimes(1);
    expect(other.emit).not.toHaveBeenCalled();
  });

  it('verb-scoped patterns match across roles', async () => {
    const socket = makeSocket(['lt.events.system.escalation.*.*.created']);
    await adapterWithSockets([socket]).publish(event);
    expect(socket.emit).toHaveBeenCalledTimes(1);
  });

  it('multiple matching patterns deliver the event once', async () => {
    const socket = makeSocket([
      'lt.events.system.escalation.>',
      'lt.events.system.escalation.*.*.created',
    ]);
    await adapterWithSockets([socket]).publish(event);
    expect(socket.emit).toHaveBeenCalledTimes(1);
  });

  it('a scoped socket receives nothing for unrelated families', async () => {
    const socket = makeSocket(['lt.events.system.escalation.>']);
    await adapterWithSockets([socket]).publish(makeEvent('system.task.t-1.created'));
    expect(socket.emit).not.toHaveBeenCalled();
  });
});
