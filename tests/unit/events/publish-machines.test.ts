import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { eventRegistry } from '../../../lib/events';
import { InMemoryEventAdapter } from '../../../lib/events/memory';
import { machineLogToken, publishMachineLogEvent, publishMachineWireEvent } from '../../../lib/events/publish';
import type { WireEvent } from '../../../types/machines-view';

const wire: WireEvent = {
  type: 'machine.wire', siteId: 'site 1', lineId: 'line.1', machineId: 'press-01', address: 'press-01', direction: 'in',
  channel: 'job', topic: 'line/v1/site 1/line.1/press-01/job', id: 'm-1', at: '2026-03-01T08:00:00.000Z', retained: false,
  kind: 'job', event: 'arrived', summary: 'job arrived U1', violations: [], actions: [{ verb: 'accumulate', rowId: 'h-1', itemKey: 'arrived:U1' }],
  payload: { body: { event: 'arrived' } },
};

describe('machine event publishing', () => {
  let adapter: InMemoryEventAdapter;

  beforeEach(async () => {
    adapter = new InMemoryEventAdapter();
    eventRegistry.register(adapter);
    await eventRegistry.connect();
  });

  afterEach(async () => {
    await eventRegistry.disconnect();
    eventRegistry.clear();
  });

  it('a wire event goes out under machine.wire.<site>.<line>.<machine>.<direction>, tokens sanitized, with the record as data', async () => {
    await publishMachineWireEvent(wire);
    expect(adapter.events).toHaveLength(1);
    expect(adapter.events[0]).toMatchObject({ type: 'machine.wire.site-1.line-1.press-01.in', source: 'machine-gateway', timestamp: wire.at, data: wire });
  });

  it('a message from an address no station claims is published under the unknown machine', async () => {
    await publishMachineWireEvent({ ...wire, machineId: null, direction: 'out' });
    expect(adapter.events[0].type).toBe('machine.wire.site-1.line-1.unknown.out');
  });

  it('a log entry goes out under machine.log.<site>.<line>.<event> with its level and context', async () => {
    await publishMachineLogEvent({ siteId: 'site-1', lineId: 'line-1', level: 'warn', event: 'machine_gateway.dispatch.refused', context: { row: 'h-1' } });
    expect(adapter.events[0]).toMatchObject({
      type: 'machine.log.site-1.line-1.dispatch-refused', source: 'machine-gateway',
      data: { level: 'warn', event: 'machine_gateway.dispatch.refused', siteId: 'site-1', lineId: 'line-1', row: 'h-1' },
    });
  });

  it('the log token drops the gateway prefix and keeps one subject level', () => {
    expect(machineLogToken('machine_gateway.verb.row_not_visible')).toBe('verb-row_not_visible');
    expect(machineLogToken('custom.event')).toBe('custom-event');
  });

  it('publishing with no adapters is a no-op', async () => {
    eventRegistry.clear();
    await expect(publishMachineWireEvent(wire)).resolves.toBeUndefined();
  });
});
