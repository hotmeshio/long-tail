/**
 * The messaging registry: one provider, registered at startup and shared by
 * every part of Long Tail that needs pub/sub or durable streams (events, the
 * machine surface). Asking for messaging that is not configured fails loudly,
 * because a caller that gets nothing back would believe it was handled.
 */

import type { LTMessagingProvider, LTPubSub, LTStreams } from '../../types/messaging';
import { loggerRegistry } from '../logger';
import { MESSAGING_LOG } from './constants';

const NOT_CONFIGURED = 'No messaging provider is configured: set LT_MESSAGING=nats with LT_NATS_URL, or pass start({ messaging })';

class LTMessagingRegistry {
  private current: LTMessagingProvider | null = null;

  /** Register the provider; replaces any registered before. Call before connect(). */
  register(provider: LTMessagingProvider): void {
    this.current = provider;
  }

  get hasProvider(): boolean {
    return this.current !== null;
  }

  get provider(): LTMessagingProvider {
    if (!this.current) throw new Error(NOT_CONFIGURED);
    return this.current;
  }

  get pubsub(): LTPubSub {
    return this.provider.pubsub;
  }

  get streams(): LTStreams {
    const streams = this.provider.streams;
    if (!streams) throw new Error(`Messaging provider ${this.provider.name} has no durable streams; enable JetStream on its NATS server`);
    return streams;
  }

  async connect(): Promise<void> {
    if (!this.current || this.current.connected) return;
    await this.current.connect();
    loggerRegistry.info(`${MESSAGING_LOG.CONNECTED} provider=${this.current.name} streams=${this.current.streams ? 'yes' : 'no'}`);
  }

  async disconnect(): Promise<void> {
    if (!this.current?.connected) return;
    await this.current.disconnect();
    loggerRegistry.info(`${MESSAGING_LOG.DISCONNECTED} provider=${this.current.name}`);
  }

  /** Forget the provider (tests). */
  clear(): void {
    this.current = null;
  }
}

export const messagingRegistry = new LTMessagingRegistry();
export { MemoryMessagingProvider } from './memory';
export { subjectMatches, isSubject } from './subjects';
export { DELIVERY, START_AT, MESSAGING_LOG, LT_SUBJECTS } from './constants';
