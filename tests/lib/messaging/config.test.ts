import { describe, expect, it } from 'vitest';
import { resolveMessaging } from '../../../lib/messaging/config';
import { MemoryMessagingProvider } from '../../../lib/messaging';
import { NatsMessagingProvider } from '../../../lib/messaging/nats/provider';

describe('resolving messaging', () => {
  it('is off unless something configures it, whatever EVENT_TRANSPORT says', () => {
    expect(resolveMessaging({}, {})).toEqual({ provider: null, ws: {} });
    expect(resolveMessaging({}, { EVENT_TRANSPORT: 'nats', NATS_URL: 'nats://x:4222' }).provider).toBeNull();
  });

  it('takes an explicit provider over everything else', () => {
    const provider = new MemoryMessagingProvider();
    expect(resolveMessaging({ messaging: { provider, nats: { url: 'nats://x' } } }, { LT_MESSAGING: 'nats' }).provider).toBe(provider);
  });

  it('builds NATS from start({ messaging: { nats } }), with what browsers need beside it', () => {
    const r = resolveMessaging({ messaging: { nats: { url: 'nats://nats:4222', token: 't', ws: { proxy: 'ws://nats:9222' } } } }, {});
    expect(r.provider).toBeInstanceOf(NatsMessagingProvider);
    expect(r.ws).toEqual({ proxy: 'ws://nats:9222', token: 't' });
  });

  it('reads LT_MESSAGING and LT_NATS_* from the environment, and fails loudly on a bad or incomplete one', () => {
    const r = resolveMessaging({}, { LT_MESSAGING: 'nats', LT_NATS_URL: 'nats://nats:4222', LT_NATS_USER: 'lt-server', LT_NATS_PASSWORD: 'p', LT_NATS_WS_URL: 'ws://h:9222' });
    expect(r.provider).toBeInstanceOf(NatsMessagingProvider);
    expect(r.ws).toEqual({ url: 'ws://h:9222', proxy: undefined, token: undefined });
    expect(resolveMessaging({}, { LT_MESSAGING: 'memory' }).provider).toBeInstanceOf(MemoryMessagingProvider);
    expect(() => resolveMessaging({}, { LT_MESSAGING: 'nats' })).toThrow(/LT_NATS_URL/);
    expect(() => resolveMessaging({}, { LT_MESSAGING: 'kafka' })).toThrow(/not one of nats, memory/);
  });

  it('still honors the older events.nats, as NATS messaging', () => {
    const r = resolveMessaging({ events: { nats: { url: 'nats://old:4222', wsUrl: 'ws://old:9222', token: 'tok' } } }, {});
    expect(r.provider).toBeInstanceOf(NatsMessagingProvider);
    expect(r.ws).toMatchObject({ url: 'ws://old:9222', token: 'tok' });
  });
});
