import { describe, it, expect } from 'vitest';
import { portalRefreshPatterns } from '../portal-refresh';

const same = (u: string) => u;
const FAMILY = 'lt.events.system.escalation.*.*.>';

describe('portalRefreshPatterns', () => {
  it('subscribes once per queue, sorted', () => {
    expect(portalRefreshPatterns([
      { url: '/escalations/available?role=reviewer' },
      { url: '/escalations/available?role=reviewer&status=claimed' },
      { url: '/escalations/available?role=printer-harvest&view=table' },
    ], same)).toEqual([
      'lt.events.system.escalation.printer-harvest.*.>',
      'lt.events.system.escalation.reviewer.*.>',
    ]);
  });

  it('a lone roles entry names its queue', () => {
    expect(portalRefreshPatterns([{ url: '/escalations/available?roles=%5B%22bin%22%5D' }], same))
      .toEqual(['lt.events.system.escalation.bin.*.>']);
  });

  it('sanitizes a role with spaces into one subject token', () => {
    expect(portalRefreshPatterns([{ url: '/escalations/available?role=qc%20inspector' }], same))
      .toEqual(['lt.events.system.escalation.qc-inspector.*.>']);
  });

  it('a URL naming no single queue widens to the family', () => {
    expect(portalRefreshPatterns([{ url: '/escalations/available?role=reviewer' }, { url: '/escalations?status=all' }], same))
      .toEqual([FAMILY]);
  });

  it('resolves link variables and ignores non-list URLs', () => {
    expect(portalRefreshPatterns(
      [{ url: '/operations' }, { url: '/escalations/available?role={lt:queue}' }],
      (u) => u.replace('{lt:queue}', 'gluer'),
    )).toEqual(['lt.events.system.escalation.gluer.*.>']);
    expect(portalRefreshPatterns([{ url: '/operations' }], same)).toEqual([]);
  });
});
