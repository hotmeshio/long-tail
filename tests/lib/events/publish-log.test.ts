import { describe, expect, it, vi } from 'vitest';

const logger = vi.hoisted(() => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }));
vi.mock('../../../lib/logger', () => ({ loggerRegistry: logger }));
vi.mock('../../../lib/events/index', () => ({ eventRegistry: { hasAdapters: true, publish: async () => undefined } }));

import { publishMachineWireEvent } from '../../../lib/events/publish';

describe('the publish log line', () => {
  it('notes a published event at debug, not info: a line wire carries many a second', async () => {
    await publishMachineWireEvent({
      type: 'machine.wire', siteId: 's', lineId: 'l', machineId: 'm', address: 'm', direction: 'in', channel: 'telemetry',
      topic: 's/l/m/telemetry', id: '1', at: '2026-11-01T00:00:00.000Z', retained: false, kind: 'telemetry', event: null,
      summary: 'telemetry', violations: [], actions: [],
    });
    expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining('[lt-pub] machine.wire'));
    expect(logger.info).not.toHaveBeenCalled();
  });
});
