import { describe, it, expect } from 'vitest';
import { embedWriteRunsNow, isReadOnlyLogin } from '../station-login';
import type { LTUserRole } from '../../api/types/users';

const grant = (over: Partial<LTUserRole>): LTUserRole => ({
  role: 'floor-role', type: 'member', read_scope: 'all', write_scope: 'none', created_at: '', ...over,
});

describe('isReadOnlyLogin', () => {
  it('a station: member grants that all read and never write', () => {
    expect(isReadOnlyLogin([grant({}), grant({ role: 'harvest', read_scope: 'self' })])).toBe(true);
  });

  it('any write scope makes it an operator', () => {
    expect(isReadOnlyLogin([grant({}), grant({ role: 'harvest', write_scope: 'self' })])).toBe(false);
    expect(isReadOnlyLogin([grant({ write_scope: 'all' })])).toBe(false);
  });

  it('an admin or superadmin grant is a person, whatever the scope columns say', () => {
    expect(isReadOnlyLogin([grant({ type: 'admin' })])).toBe(false);
    expect(isReadOnlyLogin([grant({}), grant({ role: 'admin', type: 'superadmin' })])).toBe(false);
  });

  it('unknown or empty memberships are not a station', () => {
    expect(isReadOnlyLogin(undefined)).toBe(false);
    expect(isReadOnlyLogin([])).toBe(false);
  });
});

describe('embedWriteRunsNow', () => {
  const station = [grant({})];
  const operator = [grant({ write_scope: 'all' })];

  it('a login with its own write authority runs embedded actions', () => {
    expect(embedWriteRunsNow(operator, true, null)).toBe(true);
  });

  it('a station runs them on a live grant and asks for a badge otherwise', () => {
    expect(embedWriteRunsNow(station, true, { subjectScoped: false })).toBe(true);
    expect(embedWriteRunsNow(station, true, null)).toBe(false);
    expect(embedWriteRunsNow(station, true, { subjectScoped: true })).toBe(false);
  });

  it('runs them when scanning is off, as no badge can answer', () => {
    expect(embedWriteRunsNow(station, false, null)).toBe(true);
  });
});
