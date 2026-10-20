import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

vi.mock('../useAuth', () => ({ useAuth: vi.fn() }));
vi.mock('../../api/roles', () => ({ useRoleDetails: vi.fn() }));
const mockActing = vi.fn();
vi.mock('../useActingIdentity', () => ({ useActingIdentityOptional: () => mockActing() }));

import { useAuth } from '../useAuth';
import { useRoleDetails } from '../../api/roles';
import { useLinkVariables } from '../useLinkVariables';
import { setLinkVarValue } from '../../lib/link-vars';

const mockAuth = vi.mocked(useAuth);
const mockRoleDetails = vi.mocked(useRoleDetails);

function auth(roles: string[], opts: { superadmin?: boolean; admin?: boolean } = {}) {
  return {
    user: { userId: 'u1', roles: roles.map((role) => ({ role })) },
    isSuperAdmin: opts.superadmin ?? false,
    hasRoleType: (t: string) => t === 'admin' && (opts.admin ?? false),
  } as unknown as ReturnType<typeof useAuth>;
}

function roleData(roles: Array<{ role: string; properties?: Record<string, unknown> }>) {
  return { data: { roles } } as unknown as ReturnType<typeof useRoleDetails>;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockActing.mockReturnValue(null);
  localStorage.clear();
  mockAuth.mockReturnValue(auth(['gluer']));
  mockRoleDetails.mockReturnValue(roleData([
    { role: 'gluer', properties: { link_variables: [{ name: 'facility', label: 'Facility', default: 'main' }] } },
    { role: 'finisher', properties: { link_variables: [{ name: 'bench' }] } },
  ]));
});

describe('useLinkVariables', () => {
  it('unions declarations across MEMBER roles only', () => {
    mockAuth.mockReturnValue(auth(['gluer', 'finisher']));
    const { result } = renderHook(() => useLinkVariables());
    expect(result.current.declarations.map((d) => d.name)).toEqual(['facility', 'bench']);
    expect(result.current.declarations[0].fromRole).toBe('gluer');
  });

  it('excludes declarations from roles the user does not hold', () => {
    const { result } = renderHook(() => useLinkVariables());
    expect(result.current.declarations.map((d) => d.name)).toEqual(['facility']);
  });

  it('global viewers see every role\'s declarations', () => {
    mockAuth.mockReturnValue(auth([], { superadmin: true }));
    const { result } = renderHook(() => useLinkVariables());
    expect(result.current.declarations.map((d) => d.name)).toEqual(['facility', 'bench']);
  });

  it('admin role type counts as a global viewer', () => {
    mockAuth.mockReturnValue(auth(['gluer'], { admin: true }));
    const { result } = renderHook(() => useLinkVariables());
    expect(result.current.declarations.map((d) => d.name)).toEqual(['facility', 'bench']);
  });

  it('first declaring role wins a name collision', () => {
    mockAuth.mockReturnValue(auth(['gluer', 'finisher']));
    mockRoleDetails.mockReturnValue(roleData([
      { role: 'gluer', properties: { link_variables: [{ name: 'facility', default: 'a' }] } },
      { role: 'finisher', properties: { link_variables: [{ name: 'facility', default: 'b' }] } },
    ]));
    const { result } = renderHook(() => useLinkVariables());
    expect(result.current.declarations).toHaveLength(1);
    expect(result.current.declarations[0]).toMatchObject({ fromRole: 'gluer', default: 'a' });
    expect(result.current.defaults).toEqual({ facility: 'a' });
  });

  it('ignores malformed declarations', () => {
    mockRoleDetails.mockReturnValue(roleData([
      { role: 'gluer', properties: { link_variables: [{ name: '' }, 'bad', { name: 'ok' }] } },
    ]));
    const { result } = renderHook(() => useLinkVariables());
    expect(result.current.declarations.map((d) => d.name)).toEqual(['ok']);
  });

  it('resolveUrl reacts to setValue and resolves device > default > drop', () => {
    const url = `/e?facets=${encodeURIComponent(JSON.stringify({ facility: '{lt:facility}' }))}`;
    const { result } = renderHook(() => useLinkVariables());

    // unbound → declared default
    expect(result.current.resolveUrl(url)).toContain(encodeURIComponent('"main"'));

    act(() => result.current.setValue('facility', 'soleful'));
    expect(result.current.values).toEqual({ facility: 'soleful' });
    expect(result.current.resolveUrl(url)).toContain(encodeURIComponent('"soleful"'));

    act(() => result.current.setValue('facility', null));
    expect(result.current.resolveUrl(url)).toContain(encodeURIComponent('"main"'));
  });

  it('external store writes propagate into the hook', () => {
    const { result } = renderHook(() => useLinkVariables());
    act(() => setLinkVarValue('u1', 'facility', 'east'));
    expect(result.current.values).toEqual({ facility: 'east' });
  });

  describe('{lt:me}', () => {
    const url = '/escalations/available?facets=' + encodeURIComponent(JSON.stringify({ resolved_by: '{lt:me}' }));
    const meOf = (resolved: string) => JSON.parse(new URL(resolved, 'http://x').searchParams.get('facets')!).resolved_by;

    it('reads the signed-in user', () => {
      const { result } = renderHook(() => useLinkVariables());
      expect(meOf(result.current.resolveUrl(url))).toBe('u1');
    });

    it('reads the badged person while a grant is live', () => {
      mockActing.mockReturnValue({ actorId: 'badged-1', subjectScoped: false });
      const { result } = renderHook(() => useLinkVariables());
      expect(meOf(result.current.resolveUrl(url))).toBe('badged-1');
    });
  });
});

