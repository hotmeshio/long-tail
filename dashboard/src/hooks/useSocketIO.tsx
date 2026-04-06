import {
  useEffect,
  useRef,
  useCallback,
  createContext,
  useContext,
  useState,
  type ReactNode,
} from 'react';
import { io, type Socket } from 'socket.io-client';

import { subjectMatchesPattern } from '../lib/events/matching';
import type { NatsLTEvent, NatsEventHandler } from '../lib/nats/types';
import { EventContext } from './useEventContext';

// ── Context ─────────────────────────────────────────────────────────────────

interface SocketIOContextValue {
  /** Whether the socket.io connection is active. */
  connected: boolean;
  /**
   * Register a callback for events matching a subject pattern.
   * Returns an unsubscribe function. Same API as NatsProvider.
   *
   * @param pattern — NATS-style subject pattern (e.g. `lt.events.task.>`)
   * @param handler — called for each matching event
   */
  subscribe: (pattern: string, handler: NatsEventHandler) => () => void;
}

const SocketIOContext = createContext<SocketIOContextValue>({
  connected: false,
  subscribe: () => () => {},
});

// ── Hooks ───────────────────────────────────────────────────────────────────

/**
 * Read the socket.io connection status from the nearest `SocketIOProvider`.
 */
export function useSocketIOStatus(): { connected: boolean } {
  const { connected } = useContext(SocketIOContext);
  return { connected };
}

/**
 * Subscribe to socket.io events matching a subject pattern.
 * Same API as `useNatsSubscription`.
 */
export function useSocketIOSubscription(pattern: string, handler: NatsEventHandler): void {
  const { subscribe } = useContext(SocketIOContext);
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    const stableHandler: NatsEventHandler = (event) => handlerRef.current(event);
    return subscribe(pattern, stableHandler);
  }, [subscribe, pattern]);
}

// ── Provider ────────────────────────────────────────────────────────────────

/**
 * Maintains a single socket.io connection shared across the app.
 *
 * The server emits events as `lt.events.{type}` (e.g. `lt.events.task.created`).
 * This provider listens for all `lt.events.*` events and dispatches them to
 * registered pattern-based handlers, matching the NatsProvider API.
 */
export function SocketIOProvider({ children }: { children: ReactNode }) {
  const socketRef = useRef<Socket | null>(null);
  const [connected, setConnected] = useState(false);

  // Listener registry: pattern -> Set<handler>
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

  useEffect(() => {
    // Connect to same origin. Works for both:
    // - Production: dashboard served from same Express server
    // - Dev (Vite): proxy in vite.config.ts forwards /socket.io to backend
    const socket = io({
      path: '/socket.io',
      transports: ['polling', 'websocket'],
      upgrade: true,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 2000,
    });

    socketRef.current = socket;
    console.log('[lt-socketio] connecting...');

    socket.on('connect', () => {
      console.log('[lt-socketio] connected, id:', socket.id);
      setConnected(true);
    });

    socket.on('disconnect', (reason) => {
      console.log('[lt-socketio] disconnected:', reason);
      setConnected(false);
    });

    socket.on('connect_error', (err) => {
      console.warn('[lt-socketio] connect error:', err.message);
      setConnected(false);
    });

    // Listen for all Long Tail events.
    // The server emits events with the full subject as the event name,
    // e.g. socket.emit('lt.events.task.created', payload).
    // We use a catch-all listener to handle any lt.* event.
    socket.onAny((eventName: string, data: unknown) => {
      if (!eventName.startsWith('lt.')) return;

      try {
        const event: NatsLTEvent = typeof data === 'string' ? JSON.parse(data) : data as NatsLTEvent;
        dispatchToListeners(eventName, event);
      } catch {
        // ignore malformed messages
      }
    });

    return () => {
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
      setConnected(false);
    };
  }, [dispatchToListeners]);

  return (
    <SocketIOContext.Provider value={{ connected, subscribe }}>
      <EventContext.Provider value={{ connected, subscribe }}>
        {children}
      </EventContext.Provider>
    </SocketIOContext.Provider>
  );
}
