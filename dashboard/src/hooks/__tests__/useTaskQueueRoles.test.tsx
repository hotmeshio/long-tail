import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

vi.mock('../useAuth', () => ({ useAuth: vi.fn() }));
vi.mock('../usePersona', () => ({ usePersona: vi.fn() }));

import { useAuth } from '../useAuth';
import { usePersona } from '../usePersona';
import { useTaskQueueRoles } from '../useTaskQueueRoles';
import { addTaskQueueRole } from '../../lib/task-queues';

const mockAuth = vi.mocked(useAuth);
const mockPersona = vi.mocked(usePersona);

function withRoles(roles: { role: string; type: string }[]) {
  mockAuth.mockReturnValue({ user: { roles } } as unknown as ReturnType<typeof useAuth>);
}

function persona(source: 'membership' | 'manual') {
  mockPersona.mockReturnValue({ taskQueueSource: source } as ReturnType<typeof usePersona>);
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

describe('useTaskQueueRoles — membership source', () => {
  it('returns the user\'s roles minus the capability tiers, sorted and deduped', () => {
    persona('membership');
    withRoles([
      { role: 'engineer', type: 'member' },
      { role: 'printer', type: 'member' },
      { role: 'grinder', type: 'member' },
      { role: 'printer', type: 'member' },
    ]);
    const { result } = renderHook(() => useTaskQueueRoles());
    expect(result.current).toEqual(['grinder', 'printer']);
  });

  it('ignores the manual localStorage list entirely', () => {
    persona('membership');
    withRoles([{ role: 'reviewer', type: 'member' }]);
    addTaskQueueRole('unrelated');
    const { result } = renderHook(() => useTaskQueueRoles());
    expect(result.current).toEqual(['reviewer']);
  });
});

describe('useTaskQueueRoles — manual source', () => {
  it('reads the curated localStorage list', () => {
    persona('manual');
    withRoles([{ role: 'admin', type: 'admin' }]);
    addTaskQueueRole('printer');
    addTaskQueueRole('grinder');
    const { result } = renderHook(() => useTaskQueueRoles());
    expect(result.current).toEqual(['grinder', 'printer']);
  });

  it('updates live when a role is added elsewhere (custom event)', () => {
    persona('manual');
    withRoles([{ role: 'admin', type: 'admin' }]);
    const { result } = renderHook(() => useTaskQueueRoles());
    expect(result.current).toEqual([]);

    act(() => { addTaskQueueRole('printer'); });
    expect(result.current).toEqual(['printer']);
  });
});
