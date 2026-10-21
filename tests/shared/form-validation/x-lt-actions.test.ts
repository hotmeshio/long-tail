import { describe, it, expect } from 'vitest';

import {
  actionRefusal,
  batchKeyCode,
  enteredCodeMatches,
  holdsActionRole,
  printedKeyCode,
  interpolatePayload,
  offersAction,
  readRosterActions,
  rosterActionKind,
  type RosterActionDef,
} from '../../../shared/form-validation/x-lt-actions';
import type { RosterEntry } from '../../../shared/form-validation/x-lt-roster';

const waiting: RosterEntry = { key: 'b', state: 'waiting' };
const flagged: RosterEntry = { key: 'b', state: 'flagged', flag: 'Missing' };
const withRow: RosterEntry = { key: 'o-1', state: 'waiting', row: { escalation: { id: 'm-1' }, metadata: { orderId: 'o-1' } } };

describe('rosterActionKind and readRosterActions', () => {
  it('names the one act an action declares', () => {
    expect(rosterActionKind({ label: 'x', resolverPayload: {} })).toBe('resolve');
    expect(rosterActionKind({ label: 'x', fill: {} })).toBe('fill');
    expect(rosterActionKind({ label: 'x', flag: { label: 'Missing' } })).toBe('flag');
    expect(rosterActionKind({ label: 'x', unflag: true })).toBe('unflag');
  });

  it('reads no act from none, several, or a flag without a label', () => {
    expect(rosterActionKind({ label: 'x' })).toBeNull();
    expect(rosterActionKind({ label: 'x', resolverPayload: {}, unflag: true })).toBeNull();
    expect(rosterActionKind({ label: 'x', flag: { label: '' } })).toBeNull();
  });

  it('keeps only labeled actions with one act, in order', () => {
    const actions = readRosterActions({ 'x-lt-actions': [
      { label: 'A', unflag: true }, { label: '', unflag: true }, { label: 'B' }, 'x', { label: 'C', fill: {} },
    ] });
    expect(actions.map((a) => a.label)).toEqual(['A', 'C']);
    expect(readRosterActions({})).toEqual([]);
  });
});

describe('offersAction', () => {
  it('offers each act in its default states', () => {
    expect(offersAction({ label: 'r', resolverPayload: {} }, withRow, false)).toBe(true);
    expect(offersAction({ label: 'f', fill: {} }, flagged, true)).toBe(true);
    expect(offersAction({ label: 'g', flag: { label: 'Missing' } }, waiting, true)).toBe(true);
    expect(offersAction({ label: 'g', flag: { label: 'Missing' } }, flagged, true)).toBe(false);
    expect(offersAction({ label: 'u', unflag: true }, flagged, true)).toBe(true);
    expect(offersAction({ label: 'u', unflag: true }, waiting, true)).toBe(false);
  });

  it('follows a declared when', () => {
    expect(offersAction({ label: 'f', fill: {}, when: 'waiting' }, flagged, true)).toBe(false);
    expect(offersAction({ label: 'r', resolverPayload: {}, when: ['in'] }, { ...withRow, state: 'in' }, false)).toBe(true);
  });

  it('offers a resolve only with a member row and batch acts only on a batch', () => {
    expect(offersAction({ label: 'r', resolverPayload: {} }, waiting, true)).toBe(false);
    expect(offersAction({ label: 'f', fill: {} }, withRow, false)).toBe(false);
  });
});

describe('holdsActionRole and actionRefusal', () => {
  const managerOnly: RosterActionDef = { label: 'Key in', fill: {}, roles: ['manager'] };

  it('lets anyone run an action without roles', () => {
    expect(holdsActionRole({ label: 'x', fill: {} }, [])).toBe(true);
  });

  it('requires one of the roles, and superadmin always holds them', () => {
    expect(holdsActionRole(managerOnly, ['packer'])).toBe(false);
    expect(holdsActionRole(managerOnly, ['packer', 'manager'])).toBe(true);
    expect(holdsActionRole(managerOnly, [], true)).toBe(true);
  });

  it('says the declared refusal, or names the roles', () => {
    expect(actionRefusal({ ...managerOnly, refuse: "A manager's badge is needed." })).toBe("A manager's badge is needed.");
    expect(actionRefusal(managerOnly)).toBe('Key in needs the role: manager.');
    expect(actionRefusal({ ...managerOnly, roles: ['manager', 'lead'] })).toBe('Key in needs one of these roles: manager, lead.');
  });
});

describe('codes', () => {
  it('reads the code a counted key names', () => {
    expect(batchKeyCode('00812999000011#2')).toBe('00812999000011');
    expect(batchKeyCode('00812999000011')).toBe('00812999000011');
    expect(batchKeyCode('a-b', '-')).toBe('a-b');
    expect(batchKeyCode('a-2', '-')).toBe('a');
  });

  it('matches a typed UPC-A against its GTIN-14 key', () => {
    expect(enteredCodeMatches('812999000011', '00812999000011#1')).toBe(true);
    expect(enteredCodeMatches(' 0812999000011 ', '00812999000011#2')).toBe(true);
    expect(enteredCodeMatches('812999000028', '00812999000011#1')).toBe(false);
  });

  it('prints a key’s code as its label does', () => {
    expect(printedKeyCode('00812999000028#1')).toBe('0812999000028');
    expect(printedKeyCode('INSOLE-L')).toBe('INSOLE-L');
  });

  it('compares other codes as trimmed text', () => {
    expect(enteredCodeMatches(' INSOLE-L ', 'INSOLE-L')).toBe(true);
    expect(enteredCodeMatches('', 'INSOLE-L')).toBe(false);
  });
});

describe('interpolatePayload', () => {
  it('interpolates string leaves and keeps other types', () => {
    expect(interpolatePayload({ order: '{{metadata.orderId}}', n: 2, tags: ['{{metadata.orderId}}'], ok: true },
      { metadata: { orderId: 'o-1' } })).toEqual({ order: 'o-1', n: 2, tags: ['o-1'], ok: true });
  });
});
