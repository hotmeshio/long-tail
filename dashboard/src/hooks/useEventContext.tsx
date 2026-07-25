import { createContext, useContext, useEffect, useMemo, useRef } from 'react';
import type { NatsEventHandler } from '../lib/nats/types';

/**
 * Unified event context — all event transports (socket.io, NATS)
 * write to this so consumer hooks work regardless of transport.
 */
export interface EventContextValue {
  connected: boolean;
  subscribe: (pattern: string, handler: NatsEventHandler) => () => void;
}

export const EventContext = createContext<EventContextValue>({
  connected: false,
  subscribe: () => () => {},
});

/** Read connection status from whichever transport is active. */
export function useEventStatus(): { connected: boolean } {
  const { connected } = useContext(EventContext);
  return { connected };
}

/** Subscribe to events matching a pattern. Works with any transport. */
export function useEventSubscription(pattern: string, handler: NatsEventHandler): void {
  const { subscribe } = useContext(EventContext);
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    const stableHandler: NatsEventHandler = (event) => handlerRef.current(event);
    return subscribe(pattern, stableHandler);
  }, [subscribe, pattern]);
}

/**
 * Subscribe one handler to a SET of patterns — for surfaces whose scope is a
 * union (one pattern per verb, one per member role). Patterns are compared by
 * value, so a caller may build the array inline.
 */
export function useEventSubscriptions(patterns: string[], handler: NatsEventHandler): void {
  const { subscribe } = useContext(EventContext);
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  const key = patterns.join(',');
  const stablePatterns = useMemo(() => key.split(',').filter(Boolean), [key]);

  useEffect(() => {
    const stableHandler: NatsEventHandler = (event) => handlerRef.current(event);
    const unsubs = stablePatterns.map((p) => subscribe(p, stableHandler));
    return () => unsubs.forEach((u) => u());
  }, [subscribe, stablePatterns]);
}
