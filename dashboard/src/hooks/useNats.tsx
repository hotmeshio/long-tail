import {
  useEffect,
  useRef,
  useCallback,
  createContext,
  useContext,
  useState,
  type ReactNode,
} from 'react';
import { connect, type NatsConnection, type Subscription, StringCodec } from 'nats.ws';

import { NATS_WS_URL, NATS_TOKEN } from '../lib/nats/config';
import type { NatsCredentials } from '../lib/nats/credentials';
import { DEFAULT_RECONNECT_POLICY, reconnectDelay, spreadDelay, type ReconnectPolicy } from '../lib/nats/reconnect';
import type { NatsLTEvent, NatsEventHandler } from '../lib/nats/types';
import { subjectMatchesPattern } from '../lib/events/matching';
import { EventContext } from './useEventContext';

// ── Context ─────────────────────────────────────────────────────────────────

interface NatsContextValue {
  /** Whether the WebSocket is connected to NATS. */
  connected: boolean;
  /** Realtime has been down past the notice threshold while reconnecting. */
  unavailable: boolean;
  /**
   * Register a callback for events matching a subject pattern.
   * Returns an unsubscribe function. Subscriptions are ref-stable.
   *
   * @param pattern — NATS subject pattern (e.g. `lt.events.task.>` or `lt.events.>`)
   * @param handler — called for each matching event
   */
  subscribe: (pattern: string, handler: NatsEventHandler) => () => void;
}

const NatsContext = createContext<NatsContextValue>({
  connected: false,
  unavailable: false,
  subscribe: () => () => {},
});

// ── Hooks ───────────────────────────────────────────────────────────────────

/**
 * Read the NATS connection status from the nearest `NatsProvider`.
 */
export function useNatsStatus(): { connected: boolean; unavailable: boolean } {
  const { connected, unavailable } = useContext(NatsContext);
  return { connected, unavailable };
}

/**
 * Subscribe to NATS events matching a subject pattern.
 *
 * The handler is called for every event whose NATS subject matches `pattern`.
 * The subscription is automatically cleaned up when the component unmounts or
 * when the pattern/handler changes.
 *
 * @example
 * ```tsx
 * // Subscribe to all task events
 * useNatsSubscription('lt.events.task.>', (event) => {
 *   console.log('Task event:', event.type, event.taskId);
 * });
 *
 * // Subscribe to a specific workflow's events
 * useNatsSubscription(`lt.events.workflow.>`, (event) => {
 *   if (event.workflowId === myId) { ... }
 * });
 * ```
 */
export function useNatsSubscription(pattern: string, handler: NatsEventHandler): void {
  const { subscribe } = useContext(NatsContext);
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    const stableHandler: NatsEventHandler = (event) => handlerRef.current(event);
    return subscribe(pattern, stableHandler);
  }, [subscribe, pattern]);
}

// ── Provider ────────────────────────────────────────────────────────────────

const sc = StringCodec();

/**
 * Maintains a single NATS WebSocket connection shared across the app.
 *
 * Responsibilities:
 * 1. Connect, and after any drop reconnect with fresh credentials: each
 *    attempt asks `resolveCredentials` for a new URL (behind the proxy, a new
 *    ticket), backs off with jitter, runs one at a time, pauses while the tab
 *    is hidden, and stops when the server says the session ended.
 * 2. Hold ONE broker subscription per distinct active pattern, refcounted
 *    across subscribers. The broker filters, so this client receives only
 *    the subjects pages asked for. Patterns reopen on every new connection.
 * 3. Report `unavailable` once realtime has been down past the notice threshold.
 *
 * Cache invalidation is handled by per-page hooks in `useEventHooks.ts`.
 */
interface NatsProviderProps {
  children: ReactNode;
  /** Static WebSocket URL, used when no `resolveCredentials` is given. Falls back to build-time config. */
  url?: string | null;
  /** Static NATS auth token, used with `url`. Falls back to build-time config. */
  token?: string | null;
  /** Fresh connection details for each attempt. */
  resolveCredentials?: () => Promise<NatsCredentials>;
  policy?: ReconnectPolicy;
  /** Called after a connection that replaced a lost one; events sent meanwhile are not replayed. */
  onReconnect?: () => void;
  /** A change restarts the connection loop (for one, a new sign-in). */
  sessionKey?: unknown;
}

export function NatsProvider({
  children,
  url,
  token,
  resolveCredentials,
  policy = DEFAULT_RECONNECT_POLICY,
  onReconnect,
  sessionKey,
}: NatsProviderProps) {
  const ncRef = useRef<NatsConnection | null>(null);
  const [connected, setConnected] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [sessionEnded, setSessionEnded] = useState(false);

  const latest = useRef({ url, token, resolveCredentials, policy, onReconnect });
  latest.current = { url, token, resolveCredentials, policy, onReconnect };

  // Listener registry (pattern → handlers) and its live broker subscription
  // (pattern → NATS subscription). One broker subscription serves every
  // handler on the same pattern; the broker performs the subject matching.
  const listenersRef = useRef<Map<string, Set<NatsEventHandler>>>(new Map());
  const brokerSubsRef = useRef<Map<string, Subscription>>(new Map());

  const pumpSubscription = useCallback((pattern: string, sub: Subscription) => {
    (async () => {
      for await (const msg of sub) {
        try {
          // The broker already filtered by this subscription's pattern; the
          // re-check is a cheap guard against a misrouted proxy delivery.
          if (!subjectMatchesPattern(msg.subject, pattern)) continue;
          const event: NatsLTEvent = JSON.parse(sc.decode(msg.data));
          const handlers = listenersRef.current.get(pattern);
          if (!handlers) continue;
          for (const handler of handlers) {
            try {
              handler(event);
            } catch {
              // swallow handler errors
            }
          }
        } catch {
          // ignore malformed messages
        }
      }
    })();
  }, []);

  const openBrokerSub = useCallback((pattern: string) => {
    const nc = ncRef.current;
    if (!nc || nc.isClosed?.() || brokerSubsRef.current.has(pattern)) return;
    try {
      const sub = nc.subscribe(pattern);
      brokerSubsRef.current.set(pattern, sub);
      pumpSubscription(pattern, sub);
    } catch {
      // an unsubscribable pattern gets no broker delivery
    }
  }, [pumpSubscription]);

  const subscribe = useCallback((pattern: string, handler: NatsEventHandler) => {
    const map = listenersRef.current;
    if (!map.has(pattern)) {
      map.set(pattern, new Set());
    }
    map.get(pattern)!.add(handler);
    openBrokerSub(pattern);

    return () => {
      const set = map.get(pattern);
      if (set) {
        set.delete(handler);
        if (set.size === 0) {
          map.delete(pattern);
          const sub = brokerSubsRef.current.get(pattern);
          if (sub) {
            brokerSubsRef.current.delete(pattern);
            try { sub.unsubscribe(); } catch { /* already closed */ }
          }
        }
      }
    };
  }, [openBrokerSub]);

  useEffect(() => {
    let disposed = false;
    let stopped = false;
    let inFlight = false;
    let hadConnection = false;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let refetchTimer: ReturnType<typeof setTimeout> | undefined;
    setSessionEnded(false);

    const isHidden = () => typeof document !== 'undefined' && document.visibilityState === 'hidden';

    const credentials = async (): Promise<NatsCredentials> => {
      const { url: staticUrl, token: staticToken, resolveCredentials: resolve } = latest.current;
      if (resolve) return resolve();
      const resolvedUrl = staticUrl || NATS_WS_URL;
      return resolvedUrl
        ? { kind: 'ok', url: resolvedUrl, token: staticToken || NATS_TOKEN || null }
        : { kind: 'unavailable' };
    };

    const schedule = (delay = reconnectDelay(attempt++, latest.current.policy)) => {
      if (disposed || stopped) return;
      timer = setTimeout(attemptConnection, delay);
    };

    const watch = (nc: NatsConnection) => {
      nc.closed().then(() => {
        if (ncRef.current !== nc) return;
        ncRef.current = null;
        brokerSubsRef.current.clear();
        setConnected(false);
        // Every tab loses its connection at once on a deploy; spread the
        // first retry so they do not all return in the same second.
        schedule(spreadDelay(latest.current.policy));
      });
    };

    async function attemptConnection() {
      timer = undefined;
      if (disposed || stopped || inFlight || ncRef.current) return;
      // A hidden tab waits; visibilitychange resumes it.
      if (isHidden()) return;
      inFlight = true;
      try {
        const creds = await credentials();
        if (disposed) return;
        if (creds.kind === 'session-ended') {
          stopped = true;
          setSessionEnded(true);
          return;
        }
        if (creds.kind === 'unavailable') {
          schedule();
          return;
        }
        // nats.ws would reconnect to the same URL, whose ticket expires, so
        // every reconnect goes through this loop instead.
        const nc = await connect({
          servers: creds.url,
          token: creds.token ?? undefined,
          reconnect: false,
        });
        if (disposed) {
          nc.close().catch(() => {});
          return;
        }
        ncRef.current = nc;
        attempt = 0;
        setConnected(true);
        brokerSubsRef.current.clear();
        for (const pattern of listenersRef.current.keys()) {
          openBrokerSub(pattern);
        }
        if (hadConnection) {
          refetchTimer = setTimeout(() => latest.current.onReconnect?.(), spreadDelay(latest.current.policy));
        }
        hadConnection = true;
        watch(nc);
      } catch {
        if (!disposed) schedule();
      } finally {
        inFlight = false;
      }
    }

    const resume = () => {
      if (disposed || stopped || inFlight || ncRef.current || isHidden()) return;
      if (timer) clearTimeout(timer);
      attempt = 0;
      attemptConnection();
    };

    document.addEventListener('visibilitychange', resume);
    window.addEventListener('online', resume);
    attemptConnection();

    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
      if (refetchTimer) clearTimeout(refetchTimer);
      document.removeEventListener('visibilitychange', resume);
      window.removeEventListener('online', resume);
      for (const sub of brokerSubsRef.current.values()) {
        try { sub.unsubscribe(); } catch { /* already closed */ }
      }
      brokerSubsRef.current.clear();
      if (ncRef.current) {
        ncRef.current.close().catch(() => {});
        ncRef.current = null;
      }
      setConnected(false);
    };
  }, [openBrokerSub, sessionKey]);

  // The notice follows the connection state, never event silence: a quiet
  // station can go hours without events on a healthy connection.
  useEffect(() => {
    if (connected || sessionEnded) {
      setUnavailable(false);
      return;
    }
    const timer = setTimeout(() => setUnavailable(true), policy.noticeAfterMs);
    return () => clearTimeout(timer);
  }, [connected, sessionEnded, policy.noticeAfterMs]);

  return (
    <NatsContext.Provider value={{ connected, unavailable, subscribe }}>
      <EventContext.Provider value={{ connected, subscribe }}>
        {children}
      </EventContext.Provider>
    </NatsContext.Provider>
  );
}

// Re-export subject matching from shared util so existing imports continue to work
export { subjectMatchesPattern };
