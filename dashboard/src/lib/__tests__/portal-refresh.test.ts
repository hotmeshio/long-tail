import { describe, it, expect } from 'vitest';
import { portalRefreshPlan } from '../portal-refresh';

const same = (u: string) => u;

describe('portalRefreshPlan', () => {
  it('subscribes once per queue and refreshes only the moved queue\'s lists', () => {
    const plan = portalRefreshPlan([
      { url: '/escalations/available?role=reviewer' },
      { url: '/escalations/available?role=reviewer&status=claimed' },
      { url: '/escalations/available?role=printer-harvest&view=table' },
    ], same);
    expect(plan.patterns).toEqual([
      'lt.events.system.escalation.printer-harvest.*.>',
      'lt.events.system.escalation.reviewer.*.>',
    ]);
    expect(plan.keysFor('system.escalation.reviewer.abc.claimed')).toEqual([
      ['escalations', { role: 'reviewer' }],
      ['escalations', 'available', { role: 'reviewer' }],
      ['escalations', { roles: ['reviewer'] }],
      ['escalations', 'available', { roles: ['reviewer'] }],
      ['escalations', 'related', 'reviewer'],
      ['escalations', 'related-rows', 'reviewer'],
    ]);
    expect(plan.keysFor('system.escalation.printer-harvest.abc.resolved')[0]).toEqual(['escalations', { role: 'printer-harvest' }]);
  });

  it('maps a sanitized subject token back to its role', () => {
    const plan = portalRefreshPlan([{ url: '/escalations/available?role=qc%20inspector' }], same);
    expect(plan.patterns).toEqual(['lt.events.system.escalation.qc-inspector.*.>']);
    expect(plan.keysFor('system.escalation.qc-inspector.x.created').slice(0, 2)).toEqual([
      ['escalations', { role: 'qc inspector' }],
      ['escalations', 'available', { role: 'qc inspector' }],
    ]);
  });

  it('refreshes a panel pinned by a lone roles entry, and that queue\'s related sets', () => {
    const plan = portalRefreshPlan([{ url: '/escalations/available?roles=%5B%22bin%22%5D' }], same);
    expect(plan.patterns).toEqual(['lt.events.system.escalation.bin.*.>']);
    const keys = plan.keysFor('system.escalation.bin.x.updated');
    expect(keys).toContainEqual(['escalations', 'available', { roles: ['bin'] }]);
    expect(keys).toContainEqual(['escalations', 'related', 'bin']);
  });

  it('widens to the whole family when a URL names several roles or none, and for an unknown token', () => {
    const wide = portalRefreshPlan([{ url: '/escalations/available?role=reviewer' }, { url: '/escalations?status=all' }], same);
    expect(wide.patterns).toEqual(['lt.events.system.escalation.*.*.>']);
    expect(wide.keysFor('system.escalation.reviewer.x.created')).toEqual([['escalations']]);
    const scoped = portalRefreshPlan([{ url: '/escalations/available?role=reviewer' }], same);
    expect(scoped.keysFor('system.workflow.w.completed')).toEqual([['escalations']]);
  });

  it('resolves link variables before reading the role and ignores non-list URLs', () => {
    const plan = portalRefreshPlan([{ url: '/operations' }, { url: '/escalations/available?role={lt:queue}' }], (u) => u.replace('{lt:queue}', 'gluer'));
    expect(plan.patterns).toEqual(['lt.events.system.escalation.gluer.*.>']);
    expect(portalRefreshPlan([{ url: '/operations' }], same).patterns).toEqual([]);
  });
});
