import { afterEach, describe, expect, it } from 'vitest';
import { MemoryMessagingProvider, isSubject, messagingRegistry, subjectMatches } from '../../../lib/messaging';
import type { LTMessagingProvider } from '../../../types/messaging';

afterEach(() => messagingRegistry.clear());

describe('messaging registry', () => {
  it('fails loudly when nothing is configured, naming how to configure it', () => {
    expect(messagingRegistry.hasProvider).toBe(false);
    expect(() => messagingRegistry.pubsub).toThrow(/LT_MESSAGING=nats/);
    expect(() => messagingRegistry.streams).toThrow(/LT_MESSAGING=nats/);
  });

  it('serves the registered provider, connecting and disconnecting it once', async () => {
    const provider = new MemoryMessagingProvider();
    messagingRegistry.register(provider);
    await messagingRegistry.connect();
    await messagingRegistry.connect();
    expect(provider.connected).toBe(true);
    expect(messagingRegistry.pubsub).toBe(provider.pubsub);
    expect(messagingRegistry.streams).toBe(provider.streams);
    await messagingRegistry.disconnect();
    expect(provider.connected).toBe(false);
  });

  it('refuses streams from a provider that has none', () => {
    const memory = new MemoryMessagingProvider();
    const pubsubOnly: LTMessagingProvider = {
      name: 'nats', connected: true, pubsub: memory.pubsub, streams: null, connect: async () => {}, disconnect: async () => {},
    };
    messagingRegistry.register(pubsubOnly);
    expect(messagingRegistry.pubsub).toBe(memory.pubsub);
    expect(() => messagingRegistry.streams).toThrow(/enable JetStream/);
  });
});

describe('subjects', () => {
  it('matches * as one token and > as one or more trailing tokens', () => {
    expect(subjectMatches('lt.events.>', 'lt.events.system.escalation.r.1.created')).toBe(true);
    expect(subjectMatches('lt.events.>', 'lt.events')).toBe(false);
    expect(subjectMatches('lt.*.row', 'lt.events.row')).toBe(true);
    expect(subjectMatches('lt.*.row', 'lt.events.row.x')).toBe(false);
    expect(subjectMatches('*', 'lt.events')).toBe(false);
    expect(subjectMatches('lt.events', 'lt.events')).toBe(true);
  });

  it('accepts concrete subjects only', () => {
    expect(isSubject('line.v1.site-1.line-1.p1.report')).toBe(true);
    expect(isSubject('line.*.x')).toBe(false);
    expect(isSubject('line..x')).toBe(false);
    expect(isSubject('')).toBe(false);
  });
});
