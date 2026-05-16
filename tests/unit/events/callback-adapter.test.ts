import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CallbackEventAdapter } from '../../../lib/events/callback';
import type { LTEvent } from '../../../types';

function makeEvent(type: string): LTEvent {
  return { type, source: 'test', workflowId: '', workflowName: '', taskQueue: '', timestamp: new Date().toISOString() };
}

describe('CallbackEventAdapter', () => {
  let adapter: CallbackEventAdapter;

  beforeEach(async () => {
    adapter = new CallbackEventAdapter();
    await adapter.connect();
  });

  it('exact match fires callback', async () => {
    const cb = vi.fn();
    adapter.on('task.created', cb);
    await adapter.publish(makeEvent('task.created'));
    expect(cb).toHaveBeenCalledOnce();
  });

  it('exact match does not fire on mismatch', async () => {
    const cb = vi.fn();
    adapter.on('task.created', cb);
    await adapter.publish(makeEvent('task.failed'));
    expect(cb).not.toHaveBeenCalled();
  });

  it('single-token wildcard * matches one segment', async () => {
    const cb = vi.fn();
    adapter.on('task.*', cb);
    await adapter.publish(makeEvent('task.created'));
    await adapter.publish(makeEvent('task.failed'));
    expect(cb).toHaveBeenCalledTimes(2);
  });

  it('multi-segment wildcard > matches rest', async () => {
    const cb = vi.fn();
    adapter.on('app.>', cb);
    await adapter.publish(makeEvent('app.vendor.orders.error'));
    await adapter.publish(makeEvent('app.billing.invoice'));
    expect(cb).toHaveBeenCalledTimes(2);
  });

  it('> does not match different prefix', async () => {
    const cb = vi.fn();
    adapter.on('app.>', cb);
    await adapter.publish(makeEvent('workflow.started'));
    expect(cb).not.toHaveBeenCalled();
  });

  it('middle wildcard: app.*.*.error', async () => {
    const cb = vi.fn();
    adapter.on('app.*.*.error', cb);
    await adapter.publish(makeEvent('app.vendor.orders.error'));
    await adapter.publish(makeEvent('app.vendor.orders.success'));
    expect(cb).toHaveBeenCalledOnce();
  });

  it('global wildcard * matches everything', async () => {
    const cb = vi.fn();
    adapter.on('*', cb);
    await adapter.publish(makeEvent('task.created'));
    await adapter.publish(makeEvent('app.vendor.orders.error'));
    expect(cb).toHaveBeenCalledTimes(2);
  });

  it('unsubscribe removes callback', async () => {
    const cb = vi.fn();
    const unsub = adapter.on('task.created', cb);
    unsub();
    await adapter.publish(makeEvent('task.created'));
    expect(cb).not.toHaveBeenCalled();
  });

  it('multiple callbacks on same pattern all fire', async () => {
    const cb1 = vi.fn();
    const cb2 = vi.fn();
    adapter.on('task.created', cb1);
    adapter.on('task.created', cb2);
    await adapter.publish(makeEvent('task.created'));
    expect(cb1).toHaveBeenCalledOnce();
    expect(cb2).toHaveBeenCalledOnce();
  });

  it('callback errors are swallowed (fire-and-forget)', async () => {
    adapter.on('task.created', () => { throw new Error('boom'); });
    const cb = vi.fn();
    adapter.on('task.created', cb);
    await adapter.publish(makeEvent('task.created'));
    expect(cb).toHaveBeenCalledOnce(); // second callback still fires
  });

  it('disconnect clears all listeners', async () => {
    const cb = vi.fn();
    adapter.on('task.created', cb);
    await adapter.disconnect();
    await adapter.publish(makeEvent('task.created'));
    expect(cb).not.toHaveBeenCalled();
  });
});
