import { describe, it, expect } from 'vitest';

import { NatsEventAdapter } from '../../../lib/events/nats';

describe('NatsEventAdapter — config properties', () => {
  it('stores wsUrl from constructor', () => {
    const adapter = new NatsEventAdapter({ url: 'nats://localhost:4222', wsUrl: 'wss://example.com:9222' });
    expect(adapter.wsUrl).toBe('wss://example.com:9222');
  });

  it('returns null wsUrl when not configured', () => {
    const adapter = new NatsEventAdapter({ url: 'nats://localhost:4222' });
    expect(adapter.wsUrl).toBeNull();
  });

  it('setWsUrl overrides the stored value', () => {
    const adapter = new NatsEventAdapter({ url: 'nats://localhost:4222' });
    expect(adapter.wsUrl).toBeNull();

    adapter.setWsUrl('wss://derived.example.com/nats-ws');
    expect(adapter.wsUrl).toBe('wss://derived.example.com/nats-ws');
  });

  it('explicit wsUrl is not overwritten by setWsUrl when caller guards', () => {
    const adapter = new NatsEventAdapter({ url: 'nats://localhost:4222', wsUrl: 'wss://explicit.com:9222' });

    // The guard pattern used in start/index.ts and adapters/express.ts:
    // only call setWsUrl when wsUrl is not already set
    if (!adapter.wsUrl) {
      adapter.setWsUrl('wss://derived.example.com/nats-ws');
    }
    expect(adapter.wsUrl).toBe('wss://explicit.com:9222');
  });

  it('stores wsProxyTarget from constructor', () => {
    const adapter = new NatsEventAdapter({ url: 'nats://localhost:4222', wsProxy: 'ws://nats:9222' });
    expect(adapter.wsProxyTarget).toBe('ws://nats:9222');
  });

  it('returns null wsProxyTarget when not configured', () => {
    const adapter = new NatsEventAdapter({ url: 'nats://localhost:4222' });
    expect(adapter.wsProxyTarget).toBeNull();
  });

  it('stores authToken from constructor', () => {
    const adapter = new NatsEventAdapter({ url: 'nats://localhost:4222', token: 'my-secret' });
    expect(adapter.authToken).toBe('my-secret');
  });

  it('returns null authToken when not configured', () => {
    const adapter = new NatsEventAdapter({ url: 'nats://localhost:4222', token: '' });
    expect(adapter.authToken).toBeNull();
  });
});
