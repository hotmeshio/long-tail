import { describe, it, expect, vi } from 'vitest';

import { DEFAULT_LINE } from '../../../examples/workflows/machine-line/line';
import { genericCodec, type LineCodec } from '../../../lib/machines/protocol/codec';
import { MachineSurface, codecFor, surfaceConfig } from '../../../services/machines/surface';

vi.mock('../../../services/machines/leadership', () => ({
  LineLeadership: class {
    run(): Promise<void> { return Promise.resolve(); }
    stop(): Promise<void> { return Promise.resolve(); }
  },
}));

const ENV = { MACHINE_TRANSPORT: 'mqtt', MACHINE_MQTT_URL: 'mqtt://b', MACHINE_TOPIC_ROOT: 'line/v1' };
const second = { ...DEFAULT_LINE, lineId: 'line-2' };
const own: LineCodec = { ...genericCodec({ root: 'cell/v2' }), rowOps: ['probe'] };
const shared: LineCodec = { ...genericCodec({ root: 'shared/v1' }), rowOps: ['sweep'] };

describe('the codec a line runs on', () => {
  const config = surfaceConfig(ENV);

  it('is the line\'s own, then the surface\'s, then the generic line protocol', () => {
    expect(codecFor({ codecs: { 'site-1/line-2': own }, codec: shared }, config, second)).toBe(own);
    expect(codecFor({ codecs: { 'site-1/line-2': own }, codec: shared }, config, DEFAULT_LINE)).toBe(shared);
    expect(codecFor({ codecs: { 'site-1/line-2': own } }, config, DEFAULT_LINE).root).toBe('line/v1');
  });

  it('is resolved per line on the surface, for code and API declared lines alike', async () => {
    const surface = MachineSurface.start({ lines: [DEFAULT_LINE, second], env: ENV, codecs: { 'site-1/line-2': own } });
    expect(surface.commandOps('site-1', 'line-2')).toContain('probe');
    expect(surface.commandOps('site-1', 'line-1')).not.toContain('probe');
    expect(surface.describeLines().map((l) => l.machines[0].rowOps)).toEqual([undefined, ['probe']]);
    expect(await surface.declare({ ...DEFAULT_LINE, lineId: 'line-3' })).toBe('started');
    expect(surface.commandOps('site-1', 'line-3')).not.toContain('probe');
    await surface.stop();
  });
});
