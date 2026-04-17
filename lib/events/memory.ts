import type { LTEvent, LTEventAdapter } from '../../types';

/**
 * In-memory event adapter for testing.
 *
 * Captures all published events in an array that tests can inspect.
 *
 * Usage:
 * ```typescript
 * const adapter = new InMemoryEventAdapter();
 * eventRegistry.register(adapter);
 * await eventRegistry.connect();
 *
 * // ... run workflow ...
 *
 * expect(adapter.events).toContainEqual(
 *   expect.objectContaining({ type: 'milestone', workflowName: 'reviewContent' })
 * );
 * ```
 */
export class InMemoryEventAdapter implements LTEventAdapter {
  public events: LTEvent[] = [];

  async connect(): Promise<void> {
    // no-op
  }

  async publish(event: LTEvent): Promise<void> {
    this.events.push(event);
  }

  async disconnect(): Promise<void> {
    // no-op
  }

  /** Clear captured events */
  clear(): void {
    this.events = [];
  }
}
