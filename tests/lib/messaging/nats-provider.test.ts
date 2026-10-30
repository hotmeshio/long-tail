import { beforeEach, describe, expect, it, vi } from 'vitest';

const accountInfo = vi.fn();
const fakeConnection = {
  isClosed: () => false,
  drain: vi.fn(async () => {}),
  publish: vi.fn(),
  jetstreamManager: async () => ({ getAccountInfo: accountInfo }),
  jetstream: () => ({}),
};
vi.mock('nats', () => ({ connect: vi.fn(async () => fakeConnection) }));

import { NatsMessagingProvider } from '../../../lib/messaging/nats/provider';
import { MESSAGING_LOG } from '../../../lib/messaging';
import { loggerRegistry } from '../../../lib/logger';

describe('NATS messaging provider', () => {
  beforeEach(() => {
    accountInfo.mockReset();
    fakeConnection.publish.mockClear();
  });

  it('serves streams when the account has JetStream', async () => {
    accountInfo.mockResolvedValue({});
    const provider = new NatsMessagingProvider({ url: 'nats://n:4222' });
    await provider.connect();
    expect(provider.connected).toBe(true);
    expect(provider.streams).not.toBeNull();
  });

  it('serves pub/sub without streams when JetStream is not enabled, and says nothing', async () => {
    accountInfo.mockRejectedValue(new Error('503'));
    const warn = vi.spyOn(loggerRegistry, 'warn');
    const provider = new NatsMessagingProvider({ url: 'nats://n:4222' });
    await provider.connect();
    expect(provider.connected).toBe(true);
    expect(provider.streams).toBeNull();
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('keeps the connection when the JetStream check fails another way, and warns', async () => {
    accountInfo.mockRejectedValue(Object.assign(new Error('TIMEOUT'), { code: 'TIMEOUT' }));
    const warn = vi.spyOn(loggerRegistry, 'warn');
    const provider = new NatsMessagingProvider({ url: 'nats://n:4222' });
    await expect(provider.connect()).resolves.toBeUndefined();
    expect(provider.connected).toBe(true);
    expect(provider.streams).toBeNull();
    expect(warn.mock.calls[0][0]).toContain(MESSAGING_LOG.STREAMS_UNAVAILABLE);

    await provider.pubsub.publish('lt.events.x', '{}');
    expect(fakeConnection.publish).toHaveBeenCalledWith('lt.events.x', '{}');
    warn.mockRestore();
  });

  it('throws on publish before connect', async () => {
    const provider = new NatsMessagingProvider({ url: 'nats://n:4222' });
    await expect(provider.pubsub.publish('lt.events.x', '{}')).rejects.toThrow(/not connected/);
  });
});
