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

import { NATS_WS_URL, NATS_TOKEN, NATS_SUBJECT_PREFIX } from '../lib/nats/config';
import type { NatsLTEvent, NatsEventHandler } from '../lib/nats/types';

// ── Context ─────────────────────────────────────────────────────────────────

interface NatsContextValue {
  /** Whether the WebSocket is connected to NATS. */
  connected: boolean;
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
  subscribe: () => () => {},
});

// ── Hooks ───────────────────────────────────────────────────────────────────

/**
 * Read the NATS connection status from the nearest `NatsProvider`.
 */
export function useNatsStatus(): { connected: boolean } {
  const { connected } = useContext(NatsContext);
  return { connected };
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
 * 1. Connect to NATS via WebSocket with auto-reconnect
 * 2. Subscribe to `lt.events.>` and dispatch to per-page subscribers
 *
 * Cache invalidation is handled by per-page hooks in `useNatsEvents.ts`.
 */
export function NatsProvider({ children }: { children: ReactNode }) {
  const ncRef = useRef<NatsConnection | null>(null);
  const subRef = useRef<Subscription | null>(null);
  const [connected, setConnected] = useState(false);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Listener registry: pattern → Set<handler>
  const listenersRef = useRef<Map<string, Set<NatsEventHandler>>>(new Map());

  const subscribe = useCallback((pattern: string, handler: NatsEventHandler) => {
    const map = listenersRef.current;
    if (!map.has(pattern)) {
      map.set(pattern, new Set());
    }
    map.get(pattern)!.add(handler);

    return () => {
      const set = map.get(pattern);
      if (set) {
        set.delete(handler);
        if (set.size === 0) map.delete(pattern);
      }
    };
  }, []);

  const dispatchToListeners = useCallback((subject: string, event: NatsLTEvent) => {
    for (const [pattern, handlers] of listenersRef.current) {
      if (subjectMatchesPattern(subject, pattern)) {
        for (const handler of handlers) {
          try {
            handler(event);
          } catch {
            // swallow handler errors
          }
        }
      }
    }
  }, []);

  const connectNats = useCallback(async () => {
    try {
      if (ncRef.current) return;

      const nc = await connect({
        servers: NATS_WS_URL,
        token: NATS_TOKEN,
        reconnect: true,
        maxReconnectAttempts: -1,
        reconnectTimeWait: 2000,
      });

      ncRef.current = nc;
      setConnected(true);

      // Subscribe to all Long Tail events
      const sub = nc.subscribe(`${NATS_SUBJECT_PREFIX}.>`);
      subRef.current = sub;

      (async () => {
        for await (const msg of sub) {
          try {
            const event: NatsLTEvent = JSON.parse(sc.decode(msg.data));
            dispatchToListeners(msg.subject, event);
          } catch {
            // ignore malformed messages
          }
        }
      })();

      // Monitor connection status
      (async () => {
        for await (const s of nc.status()) {
          if (s.type === 'disconnect' || s.type === 'error') {
            setConnected(false);
          } else if (s.type === 'reconnect') {
            setConnected(true);
          }
        }
      })();
    } catch {
      setConnected(false);
      reconnectTimer.current = setTimeout(connectNats, 3000);
    }
  }, [dispatchToListeners]);

  useEffect(() => {
    connectNats();

    return () => {
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      if (subRef.current) subRef.current.unsubscribe();
      if (ncRef.current) {
        ncRef.current.close().catch(() => {});
        ncRef.current = null;
      }
      setConnected(false);
    };
  }, [connectNats]);

  return (
    <NatsContext.Provider value={{ connected, subscribe }}>
      {children}
    </NatsContext.Provider>
  );
}

// ── Subject matching ────────────────────────────────────────────────────────

/**
 * Match a NATS subject against a pattern with `>` (match-rest) and `*` (single-token) wildcards.
 *
 * Examples:
 * - `lt.events.task.created` matches `lt.events.>`
 * - `lt.events.task.created` matches `lt.events.task.*`
 * - `lt.events.task.created` matches `lt.events.task.created`
 * - `lt.events.task.created` does NOT match `lt.events.escalation.*`
 */
export function subjectMatchesPattern(subject: string, pattern: string): boolean {
  const subjectTokens = subject.split('.');
  const patternTokens = pattern.split('.');

  for (let i = 0; i < patternTokens.length; i++) {
    const pt = patternTokens[i];

    if (pt === '>') return true; // match-rest: everything from here matches
    if (i >= subjectTokens.length) return false; // pattern longer than subject
    if (pt !== '*' && pt !== subjectTokens[i]) return false; // literal mismatch
  }

  // Pattern consumed — subject must also be fully consumed
  return subjectTokens.length === patternTokens.length;
}
