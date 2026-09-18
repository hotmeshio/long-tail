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
    ]);
    expect(plan.keysFor('system.escalation.printer-harvest.abc.resolved')[0]).toEqual(['escalations', { role: 'printer-harvest' }]);
  });

  it('maps a sanitized subject token back to its role', () => {
    const plan = portalRefreshPlan([{ url: '/escalations/available?role=qc%20inspector' }], same);
    expect(plan.patterns).toEqual(['lt.events.system.escalation.qc-inspector.*.>']);
    expect(plan.keysFor('system.escalation.qc-inspector.x.created')).toEqual([
      ['escalations', { role: 'qc inspector' }],
      ['escalations', 'available', { role: 'qc inspector' }],
    ]);
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
