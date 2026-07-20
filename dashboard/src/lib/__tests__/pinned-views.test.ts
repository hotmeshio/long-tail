import { describe, it, expect } from 'vitest';
import { resolvePins, pinBadgeQuery, newPinId } from '../pinned-views';

const own = (label: string, extra: Partial<{ url: string; badge: boolean }> = {}) => ({
  id: `own-${label}`,
  label,
  url: extra.url ?? `/escalations/available?role=x`,
  ...(extra.badge !== undefined ? { badge: extra.badge } : {}),
});

describe('resolvePins — role-default precedence', () => {
  const ROLE_PINS = [
    { role: 'harvester', pins: [
      { id: 'r1', label: 'Needs harvesting', url: '/escalations/available?role=harvester&jeopardy=1', badge: true },
      { id: 'r2', label: 'My machines', url: '/escalations/available?role=harvester&view=table' },
    ]},
  ];

  it('own pins lead in stored order; role defaults follow, marked with their role', () => {
    const pins = resolvePins({ pinnedViews: [own('B'), own('A')] }, ROLE_PINS);
    expect(pins.map((p) => p.label)).toEqual(['B', 'A', 'Needs harvesting', 'My machines']);
    expect(pins[2].fromRole).toBe('harvester');
    expect(pins[0].fromRole).toBeUndefined();
  });

  it('an own pin with a matching label supersedes the role default (promoted)', () => {
    const pins = resolvePins({ pinnedViews: [own('Needs harvesting')] }, ROLE_PINS);
    expect(pins.filter((p) => p.label === 'Needs harvesting')).toHaveLength(1);
    expect(pins[0].fromRole).toBeUndefined();
    expect(pins.map((p) => p.label)).toEqual(['Needs harvesting', 'My machines']);
  });

  it('hidden role pins are suppressed', () => {
    const pins = resolvePins({ hiddenRolePins: ['My machines'] }, ROLE_PINS);
    expect(pins.map((p) => p.label)).toEqual(['Needs harvesting']);
  });

  it('duplicate labels across roles collapse to the first role', () => {
    const pins = resolvePins(undefined, [
      ...ROLE_PINS,
      { role: 'fleet-b', pins: [{ id: 'x', label: 'Needs harvesting', url: '/other' }] },
    ]);
    expect(pins.filter((p) => p.label === 'Needs harvesting')).toHaveLength(1);
    expect(pins[0].fromRole).toBe('harvester');
  });

  it('no preferences at all yields exactly the role defaults', () => {
    const pins = resolvePins(undefined, ROLE_PINS);
    expect(pins).toHaveLength(2);
    expect(pins.every((p) => p.fromRole === 'harvester')).toBe(true);
  });
});

describe('pinBadgeQuery — pin URL → the same query the pin opens onto', () => {
  it('parses the available pool with role + jeopardy + facets', () => {
    const q = pinBadgeQuery('/escalations/available?role=harvester&jeopardy=1&facets=%7B%22state%22%3A%22done%22%7D');
    expect(q).not.toBeNull();
    expect(q!.available).toBe(true);
    expect(q!.params.role).toBe('harvester');
    expect(q!.params.jeopardy).toBe(true);
    expect(q!.params.facets).toEqual({ state: 'done' });
  });

  it('status=all routes through the plain list spanning statuses', () => {
    const q = pinBadgeQuery('/escalations/available?role=x&status=all');
    expect(q!.available).toBe(false);
    expect(q!.params.status).toBeUndefined();
  });

  it('a concrete status narrows the plain list', () => {
    const q = pinBadgeQuery('/escalations/available?role=x&status=resolved');
    expect(q!.available).toBe(false);
    expect(q!.params.status).toBe('resolved');
  });

  it('non-escalation URLs are not countable — no badge', () => {
    expect(pinBadgeQuery('/operations')).toBeNull();
    expect(pinBadgeQuery('/escalations/detail/abc')).toBeNull();
    expect(pinBadgeQuery('not a url at all')).toBeNull();
  });
});

describe('newPinId', () => {
  it('produces distinct ids', () => {
    expect(newPinId()).not.toBe(newPinId());
  });
});
