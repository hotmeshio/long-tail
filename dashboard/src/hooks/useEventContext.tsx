import { createContext, useContext, useEffect, useRef } from 'react';
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
