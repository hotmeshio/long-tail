import { loggerRegistry } from '../logger';
import type { LTEvent, LTEventAdapter, LTEventType } from '../../types';
import { subjectMatchesPattern } from './matching';

type EventCallback = (event: LTEvent) => void;

/**
 * In-process event adapter that delivers events via registered callbacks.
 *
 * Plugs into the existing `eventRegistry` alongside Socket.IO / NATS.
 * SDK callers subscribe with `.on()` and receive events as direct
 * function calls — no network transport, no serialization overhead.
 *
 * Supports NATS-style pattern matching:
 * - Exact: `on('task.created', cb)`
 * - Single-token wildcard: `on('task.*', cb)` — matches task.created, task.failed, etc.
 * - Multi-token wildcard: `on('app.epic.>', cb)` — matches app.epic.apis.createorder.error
 * - Global wildcard: `on('*', cb)` — matches every event
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
    for (const [pattern, callbacks] of this.listeners) {
      if (subjectMatchesPattern(event.type, pattern)) {
        for (const cb of callbacks) {
          try { cb(event); } catch { /* fire-and-forget */ }
        }
      }
    }
  }

  async disconnect(): Promise<void> {
    this.listeners.clear();
    loggerRegistry.info('[lt-events:callback] adapter disconnected');
  }
}
