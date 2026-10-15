import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { useAuth } from './useAuth';
import { loadSettings } from '../api/settings';
import { fetchNatsCredentials } from '../lib/nats/credentials';
import { resolveReconnectPolicy, type ReconnectPolicy } from '../lib/nats/reconnect';
import { NatsProvider } from './useNats';
import { SocketIOProvider } from './useSocketIO';

type Transport = 'nats' | 'socketio' | null;

interface NatsSettings {
  /** The server-reported WebSocket URL, used until a session can fetch a ticket. */
  url: string | null;
  policy: ReconnectPolicy;
}

/**
 * Auto-detecting event transport provider.
 *
 * On mount, fetches `/api/settings` to check `events.transport`.
 * - `'nats'`: wraps children in `<NatsProvider>`, which fetches fresh
 *   credentials from `/api/nats-credentials` for every connection attempt
 * - `'socketio'` or default: wraps children in `<SocketIOProvider>`
 * - While loading: renders children without a provider (events disabled until detected)
 */
export function EventTransportProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAuth();
  const queryClient = useQueryClient();
  const [transport, setTransport] = useState<Transport>(null);
  const [natsSettings, setNatsSettings] = useState<NatsSettings>({
    url: null,
    policy: resolveReconnectPolicy(null),
  });

  useEffect(() => {
    let cancelled = false;

    async function detect() {
      try {
        console.log('[lt-transport] detecting event transport...');
        const data = await loadSettings() as any;
        const value = data?.events?.transport;
        console.log('[lt-transport] server reports:', value);
        if (!cancelled) {
          if (value === 'nats') {
            setNatsSettings({
              url: data.events.natsWsUrl ?? null,
              policy: resolveReconnectPolicy(data.events.reconnect),
            });
          }
          setTransport(value === 'nats' ? 'nats' : 'socketio');
        }
      } catch (err) {
        console.warn('[lt-transport] settings fetch error, falling back to socketio', err);
        if (!cancelled) setTransport('socketio');
      }
    }

    detect();
    return () => { cancelled = true; };
  }, [isAuthenticated]);

  const resolveCredentials = useCallback(
    () => fetchNatsCredentials(natsSettings.url),
    [natsSettings.url],
  );
  // One refetch brings open pages up to date after events missed while down.
  const refetchActive = useCallback(() => {
    queryClient.invalidateQueries({ refetchType: 'active' });
  }, [queryClient]);

  if (transport === 'nats') {
    return (
      <NatsProvider
        resolveCredentials={resolveCredentials}
        policy={natsSettings.policy}
        onReconnect={refetchActive}
        sessionKey={isAuthenticated}
      >
        {children}
      </NatsProvider>
    );
  }

  if (transport === 'socketio') {
    return <SocketIOProvider>{children}</SocketIOProvider>;
  }

  // Still detecting: render children without event provider
  return <>{children}</>;
}
