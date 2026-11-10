import { describe, it, expect, vi } from 'vitest';

import { DEFAULT_LINE } from '../../../examples/workflows/machine-line/line';
import { MachineSurface } from '../../../services/machines/surface';
import { checkItem } from '../../../services/escalation/item-checks';
import { ACK_OP, requestCodec } from '../../helpers/machine-request-codec';

vi.mock('../../../services/machines/leadership', () => ({
  LineLeadership: class {
    run(): Promise<void> { return Promise.resolve(); }
    stop(): Promise<void> { return Promise.resolve(); }
  },
}));

const ENV = { MACHINE_TRANSPORT: 'mqtt', MACHINE_MQTT_URL: 'mqtt://b', MACHINE_TOPIC_ROOT: 'line/v1' };
const request = {
  id: 'req-1', type: 'machine-request',
  metadata: { siteId: DEFAULT_LINE.siteId, lineId: DEFAULT_LINE.lineId, machineId: 'press-01', op: ACK_OP, ref: 'm-1' },
} as any;

describe('the machine surface checks answers while it runs', () => {
  it('refuses an answer its line cannot send, and stops checking once stopped', async () => {
    const surface = MachineSurface.start({ lines: [DEFAULT_LINE], env: ENV, codec: requestCodec({ encodes: false }) });
    expect(await checkItem(request, 'answer', { args: {} })).toMatch(/has no material-ack command/);
    expect(await checkItem({ ...request, type: 'machine-command' }, 'answer', { args: {} })).toBeNull();
    await surface.stop();
    expect(await checkItem(request, 'answer', { args: {} })).toBeNull();
  });

  it('accepts an answer its line sends', async () => {
    const surface = MachineSurface.start({ lines: [DEFAULT_LINE], env: ENV, codec: requestCodec() });
    expect(await checkItem(request, 'answer', { args: { accepted: true } })).toBeNull();
    await surface.stop();
  });
});
