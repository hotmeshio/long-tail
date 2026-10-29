/**
 * Which messaging provider a deployment runs, from start() or the environment.
 * Precedence: an explicit provider, then `messaging.nats` or `messaging.memory`,
 * then LT_MESSAGING with LT_NATS_*, then `events.nats` (the same NATS, configured
 * as events always have been). With none, Long Tail runs without messaging.
 */

import type { LTMessagingProvider } from '../../types/messaging';
import type { LTStartConfig } from '../../types/startup';
import { config } from '../../modules/config';
import { MemoryMessagingProvider } from './memory';
import { NatsMessagingProvider } from './nats/provider';

export const MESSAGING_KIND = { NATS: 'nats', MEMORY: 'memory' } as const;

/** What browsers need to reach the provider's events: a public WebSocket URL, a proxy target, a credential. */
export interface MessagingWs {
  url?: string;
  proxy?: string;
  token?: string;
}

export interface ResolvedMessaging {
  provider: LTMessagingProvider | null;
  ws: MessagingWs;
}

type Env = Record<string, string | undefined>;

const NONE: ResolvedMessaging = { provider: null, ws: {} };

function fromEnv(env: Env): ResolvedMessaging | null {
  const kind = env.LT_MESSAGING;
  if (!kind) return null;
  if (kind === MESSAGING_KIND.MEMORY) return { provider: new MemoryMessagingProvider(), ws: {} };
  if (kind !== MESSAGING_KIND.NATS) throw new Error(`LT_MESSAGING="${kind}" is not one of ${Object.values(MESSAGING_KIND).join(', ')}`);
  const url = env.LT_NATS_URL;
  if (!url) throw new Error('LT_MESSAGING=nats needs LT_NATS_URL');
  const token = env.LT_NATS_TOKEN || undefined;
  return {
    provider: new NatsMessagingProvider({ url, token, user: env.LT_NATS_USER || undefined, password: env.LT_NATS_PASSWORD || undefined, name: 'long-tail' }),
    ws: { url: env.LT_NATS_WS_URL || undefined, proxy: env.LT_NATS_WS_PROXY || undefined, token },
  };
}

export function resolveMessaging(start: Pick<LTStartConfig, 'messaging' | 'events'>, env: Env = process.env): ResolvedMessaging {
  const m = start.messaging;
  if (m?.provider) return { provider: m.provider, ws: m.nats?.ws ?? {} };
  if (m?.nats) {
    const { ws, ...nats } = m.nats;
    return { provider: new NatsMessagingProvider({ name: 'long-tail', ...nats }), ws: { ...ws, token: ws?.token ?? nats.token } };
  }
  if (m?.memory) return { provider: new MemoryMessagingProvider(), ws: {} };

  const configured = fromEnv(env);
  if (configured) return configured;

  const legacy = start.events?.nats;
  if (legacy) {
    const token = legacy.token || config.NATS_TOKEN || undefined;
    return {
      provider: new NatsMessagingProvider({ url: legacy.url || config.NATS_URL, token, name: 'long-tail' }),
      ws: { url: legacy.wsUrl || config.NATS_WS_URL || undefined, proxy: legacy.wsProxy, token },
    };
  }
  return NONE;
}
