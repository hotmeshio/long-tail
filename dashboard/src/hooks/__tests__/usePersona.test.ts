import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

vi.mock('../useAuth', () => ({ useAuth: vi.fn() }));
vi.mock('../../lib/view-as', () => ({ getViewAs: vi.fn() }));
vi.mock('../../api/settings', () => ({ useSettings: vi.fn() }));

import { useAuth } from '../useAuth';
import { useSettings } from '../../api/settings';
import { getViewAs } from '../../lib/view-as';
import { usePersona } from '../usePersona';

const mockAuth = vi.mocked(useAuth);
const mockSettings = vi.mocked(useSettings);
const mockViewAs = vi.mocked(getViewAs);

function auth({ superadmin = false, admin = false, engineer = false } = {}) {
  return {
    isSuperAdmin: superadmin,
    hasRoleType: (t: string) => (t === 'admin' && admin) || (t === 'superadmin' && superadmin),
    hasRole: (r: string) => r === 'engineer' && engineer,
  } as unknown as ReturnType<typeof useAuth>;
}

function settings(publicPaceBoard?: boolean) {
  return { data: { features: { publicPaceBoard } } } as unknown as ReturnType<typeof useSettings>;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockViewAs.mockReturnValue(null);
  mockSettings.mockReturnValue(settings()); // default: publicPaceBoard on
});

describe('usePersona — publicPaceBoard on (the default)', () => {
  it('operator: pace board home (no task-queue cards), no workflows', () => {
    mockAuth.mockReturnValue(auth());
    const { result } = renderHook(() => usePersona());
    expect(result.current.tier).toBe('operator');
    expect(result.current.canSeePaceBoard).toBe(true);
    expect(result.current.canSeeWorkflows).toBe(false);
    expect(result.current.showTaskQueueCards).toBe(false);
  });

  it('engineer: pace board + workflows', () => {
    mockAuth.mockReturnValue(auth({ engineer: true }));
    const { result } = renderHook(() => usePersona());
    expect(result.current.canSeePaceBoard).toBe(true);
    expect(result.current.canSeeWorkflows).toBe(true);
    expect(result.current.showTaskQueueCards).toBe(false);
  });

  it('superadmin viewing as operator: still the pace-board home — what a real operator sees', () => {
    mockAuth.mockReturnValue(auth({ superadmin: true }));
    mockViewAs.mockReturnValue('operator');
    const { result } = renderHook(() => usePersona());
    expect(result.current.tier).toBe('operator');
    expect(result.current.realTier).toBe('superadmin');
    expect(result.current.canSeePaceBoard).toBe(true);
    expect(result.current.showTaskQueueCards).toBe(false);
  });
});

describe('usePersona — publicPaceBoard off (deployment opt-out)', () => {
  beforeEach(() => mockSettings.mockReturnValue(settings(false)));

  it('operator: no pace board, sees task-queue cards', () => {
    mockAuth.mockReturnValue(auth());
    const { result } = renderHook(() => usePersona());
    expect(result.current.tier).toBe('operator');
    expect(result.current.canSeePaceBoard).toBe(false);
    expect(result.current.canSeeWorkflows).toBe(false);
    expect(result.current.showTaskQueueCards).toBe(true);
  });

  it('engineer: full builder home (workflows, no pace board), NOT the operator cards', () => {
    mockAuth.mockReturnValue(auth({ engineer: true }));
    const { result } = renderHook(() => usePersona());
    expect(result.current.tier).toBe('engineer');
    expect(result.current.canSeePaceBoard).toBe(false);
    expect(result.current.canSeeWorkflows).toBe(true);
    // Engineers are builders — the task-queue-cards home is the operator's only.
    expect(result.current.showTaskQueueCards).toBe(false);
  });

  it('admin: pace board, no workflows, no cards', () => {
    mockAuth.mockReturnValue(auth({ admin: true }));
    const { result } = renderHook(() => usePersona());
    expect(result.current.tier).toBe('admin');
    expect(result.current.canSeePaceBoard).toBe(true);
    expect(result.current.canSeeWorkflows).toBe(false);
    expect(result.current.showTaskQueueCards).toBe(false);
  });

  it('superadmin: pace board + workflows', () => {
    mockAuth.mockReturnValue(auth({ superadmin: true }));
    const { result } = renderHook(() => usePersona());
    expect(result.current.tier).toBe('superadmin');
    expect(result.current.canSeePaceBoard).toBe(true);
    expect(result.current.canSeeWorkflows).toBe(true);
  });

  it('superadmin viewing as operator: adopts the operator layout', () => {
    mockAuth.mockReturnValue(auth({ superadmin: true }));
    mockViewAs.mockReturnValue('operator');
    const { result } = renderHook(() => usePersona());
    expect(result.current.tier).toBe('operator');
    expect(result.current.realTier).toBe('superadmin');
    expect(result.current.canSeePaceBoard).toBe(false);
    expect(result.current.showTaskQueueCards).toBe(true);
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
