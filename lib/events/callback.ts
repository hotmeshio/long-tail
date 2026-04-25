import { loggerRegistry } from '../logger';
import type { LTEvent, LTEventAdapter, LTEventType } from '../../types';

type EventCallback = (event: LTEvent) => void;

/**
 * In-process event adapter that delivers events via registered callbacks.
 *
 * Plugs into the existing `eventRegistry` alongside Socket.IO / NATS.
 * SDK callers subscribe with `.on()` and receive events as direct
 * function calls — no network transport, no serialization overhead.
 *
 * Supports:
 * - Exact type matching: `on('task.created', cb)`
 * - Category wildcards: `on('task.*', cb)` — matches all task.* events
 * - Global wildcard: `on('*', cb)` — matches every event
 *
 * Usage:
 * ```typescript
 * import { CallbackEventAdapter } from '@hotmeshio/long-tail';
 * import { eventRegistry } from '@hotmeshio/long-tail';
 *
 * const adapter = new CallbackEventAdapter();
 * eventRegistry.register(adapter);
 *
 * const unsub = adapter.on('escalation.claimed', (event) => {
 *   console.log('claimed:', event.escalationId);
 * });
 *
 * // Later: unsub() to remove the listener
 * ```
 */
export class CallbackEventAdapter implements LTEventAdapter {
  private listeners = new Map<string, Set<EventCallback>>();

  /**
   * Subscribe to events by type, pattern, or wildcard.
   * Returns an unsubscribe function.
   */
  on(pattern: LTEventType | '*' | (string & {}), callback: EventCallback): () => void {
    let set = this.listeners.get(pattern);
    if (!set) {
      set = new Set();
      this.listeners.set(pattern, set);
    }
    set.add(callback);

    return () => {
      set!.delete(callback);
      if (set!.size === 0) {
        this.listeners.delete(pattern);
      }
    };
  }

  async connect(): Promise<void> {
    loggerRegistry.info('[lt-events:callback] adapter connected');
  }

  async publish(event: LTEvent): Promise<void> {
    // Exact match listeners
    const exact = this.listeners.get(event.type);
    if (exact) {
      for (const cb of exact) {
        try { cb(event); } catch { /* fire-and-forget */ }
      }
    }

    // Category wildcard listeners (e.g. 'task.*' matches 'task.created')
    const dotIdx = event.type.indexOf('.');
    if (dotIdx > 0) {
      const category = event.type.slice(0, dotIdx) + '.*';
      const catListeners = this.listeners.get(category);
      if (catListeners) {
        for (const cb of catListeners) {
          try { cb(event); } catch { /* fire-and-forget */ }
        }
      }
    }

    // Global wildcard listeners
    const global = this.listeners.get('*');
    if (global) {
      for (const cb of global) {
        try { cb(event); } catch { /* fire-and-forget */ }
      }
    }
  }

  async disconnect(): Promise<void> {
    this.listeners.clear();
    loggerRegistry.info('[lt-events:callback] adapter disconnected');
  }
}
