import { describe, it, expect } from 'vitest';

import { GATEWAY_LOG, composeLogs, eventsLog } from '../../../services/machines/gateway/log';
import { RecordingLog } from '../../../services/machines/testing/recording-log';

const LINE = { siteId: 'site-1', lineId: 'line-1' };

describe('the events log', () => {
  it('publishes each entry with its level, event and context on the line', () => {
    const published: Record<string, unknown>[] = [];
    const log = eventsLog(LINE, async (params) => { published.push(params); });
    log.info(GATEWAY_LOG.DISPATCHED, { row: 'h-1', machine: 'press-01' });
    log.warn(GATEWAY_LOG.COMMAND_REFUSED, { machine: 'press-01', op: 'pause' });
    log.error(GATEWAY_LOG.VERB_FAILED);
    expect(published).toEqual([
      { siteId: 'site-1', lineId: 'line-1', level: 'info', event: GATEWAY_LOG.DISPATCHED, context: { row: 'h-1', machine: 'press-01' } },
      { siteId: 'site-1', lineId: 'line-1', level: 'warn', event: GATEWAY_LOG.COMMAND_REFUSED, context: { machine: 'press-01', op: 'pause' } },
      { siteId: 'site-1', lineId: 'line-1', level: 'error', event: GATEWAY_LOG.VERB_FAILED, context: undefined },
    ]);
  });

  it('never throws into the gateway when publishing fails', () => {
    const log = eventsLog(LINE, () => Promise.reject(new Error('bus down')));
    expect(() => log.info(GATEWAY_LOG.STARTED)).not.toThrow();
  });
});

describe('composing logs', () => {
  it('every entry reaches each log, in order', () => {
    const a = new RecordingLog();
    const b = new RecordingLog();
    const log = composeLogs(a, b);
    log.info(GATEWAY_LOG.STARTED, { site: 'site-1' });
    log.warn(GATEWAY_LOG.UNMATCHED, { topic: 't' });
    for (const each of [a, b]) {
      expect(each.entries).toEqual([
        { level: 'info', event: GATEWAY_LOG.STARTED, context: { site: 'site-1' } },
        { level: 'warn', event: GATEWAY_LOG.UNMATCHED, context: { topic: 't' } },
      ]);
    }
  });
});
