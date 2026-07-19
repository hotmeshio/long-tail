import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

vi.mock('../useAuth', () => ({ useAuth: vi.fn() }));
vi.mock('../../lib/view-as', () => ({ getViewAs: vi.fn() }));

import { useAuth } from '../useAuth';
import { getViewAs } from '../../lib/view-as';
import { usePersona } from '../usePersona';

const mockAuth = vi.mocked(useAuth);
const mockViewAs = vi.mocked(getViewAs);

function auth({ superadmin = false, admin = false, engineer = false } = {}) {
  return {
    isSuperAdmin: superadmin,
    hasRoleType: (t: string) => (t === 'admin' && admin) || (t === 'superadmin' && superadmin),
    hasRole: (r: string) => r === 'engineer' && engineer,
  } as unknown as ReturnType<typeof useAuth>;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockViewAs.mockReturnValue(null);
});

describe('usePersona', () => {
  it('operator: no pace board, no workflows, sees task-queue cards, membership source', () => {
    mockAuth.mockReturnValue(auth());
    const { result } = renderHook(() => usePersona());
    expect(result.current.tier).toBe('operator');
    expect(result.current.canSeePaceBoard).toBe(false);
    expect(result.current.canSeeWorkflows).toBe(false);
    expect(result.current.showTaskQueueCards).toBe(true);
    expect(result.current.taskQueueSource).toBe('membership');
  });

  it('engineer: workflows + cards but no pace board, membership source', () => {
    mockAuth.mockReturnValue(auth({ engineer: true }));
    const { result } = renderHook(() => usePersona());
    expect(result.current.tier).toBe('engineer');
    expect(result.current.canSeePaceBoard).toBe(false);
    expect(result.current.canSeeWorkflows).toBe(true);
    expect(result.current.showTaskQueueCards).toBe(true);
    expect(result.current.taskQueueSource).toBe('membership');
  });

  it('admin: pace board, no workflows, no cards, manual source', () => {
    mockAuth.mockReturnValue(auth({ admin: true }));
    const { result } = renderHook(() => usePersona());
    expect(result.current.tier).toBe('admin');
    expect(result.current.canSeePaceBoard).toBe(true);
    expect(result.current.canSeeWorkflows).toBe(false);
    expect(result.current.showTaskQueueCards).toBe(false);
    expect(result.current.taskQueueSource).toBe('manual');
  });

  it('superadmin: pace board + workflows, manual source', () => {
    mockAuth.mockReturnValue(auth({ superadmin: true }));
    const { result } = renderHook(() => usePersona());
    expect(result.current.tier).toBe('superadmin');
    expect(result.current.canSeePaceBoard).toBe(true);
    expect(result.current.canSeeWorkflows).toBe(true);
    expect(result.current.taskQueueSource).toBe('manual');
  });

  it('superadmin viewing as operator: adopts the operator layout but keeps manual curation', () => {
    mockAuth.mockReturnValue(auth({ superadmin: true }));
    mockViewAs.mockReturnValue('operator');
    const { result } = renderHook(() => usePersona());
    expect(result.current.tier).toBe('operator');
    expect(result.current.realTier).toBe('superadmin');
    expect(result.current.canSeePaceBoard).toBe(false);
    expect(result.current.showTaskQueueCards).toBe(true);
    // Real tier still governs where the sidebar queues come from.
    expect(result.current.taskQueueSource).toBe('manual');
  });

  it('admin viewing as engineer: gains workflows, drops the pace board', () => {
    mockAuth.mockReturnValue(auth({ admin: true }));
    mockViewAs.mockReturnValue('engineer');
    const { result } = renderHook(() => usePersona());
    expect(result.current.tier).toBe('engineer');
    expect(result.current.canSeeWorkflows).toBe(true);
    expect(result.current.canSeePaceBoard).toBe(false);
  });
});
