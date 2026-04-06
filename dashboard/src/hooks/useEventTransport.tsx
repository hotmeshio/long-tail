import { useEffect, useState, type ReactNode } from 'react';

import { NatsProvider } from './useNats';
import { SocketIOProvider } from './useSocketIO';

type Transport = 'nats' | 'socketio' | null;

/**
 * Auto-detecting event transport provider.
 *
 * On mount, fetches `/api/settings` to check `events.transport`.
 * - `'nats'` — wraps children in `<NatsProvider>`
 * - `'socketio'` or default — wraps children in `<SocketIOProvider>`
 * - While loading — renders children without a provider (events disabled until detected)
 */
export function EventTransportProvider({ children }: { children: ReactNode }) {
  const [transport, setTransport] = useState<Transport>(null);

  useEffect(() => {
    let cancelled = false;

    async function detect() {
      try {
        console.log('[lt-transport] detecting event transport...');
        const res = await fetch('/api/settings');
        if (!res.ok) {
          console.warn('[lt-transport] settings fetch failed, falling back to socketio');
          if (!cancelled) setTransport('socketio');
          return;
        }
        const data = await res.json();
        const value = data?.events?.transport;
        console.log('[lt-transport] server reports:', value);
        if (!cancelled) {
          setTransport(value === 'nats' ? 'nats' : 'socketio');
        }
      } catch (err) {
        console.warn('[lt-transport] settings fetch error, falling back to socketio', err);
        if (!cancelled) setTransport('socketio');
      }
    }

    detect();
    return () => { cancelled = true; };
  }, []);

  if (transport === 'nats') {
    return <NatsProvider>{children}</NatsProvider>;
  }

  if (transport === 'socketio') {
    return <SocketIOProvider>{children}</SocketIOProvider>;
  }

  // Still detecting — render children without event provider
  return <>{children}</>;
}
