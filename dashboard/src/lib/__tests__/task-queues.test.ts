import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  readTaskQueueRoles,
  addTaskQueueRole,
  removeTaskQueueRole,
  toggleTaskQueueRole,
  isTaskQueueRole,
  isSystemTierRole,
  TASK_QUEUES_EVENT,
} from '../task-queues';

describe('task-queues store', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('reads an empty list when nothing is stored', () => {
    expect(readTaskQueueRoles()).toEqual([]);
  });

  it('adds a role and keeps the list sorted', () => {
    addTaskQueueRole('printer');
    addTaskQueueRole('grinder');
    expect(readTaskQueueRoles()).toEqual(['grinder', 'printer']);
  });

  it('does not add a duplicate', () => {
    addTaskQueueRole('printer');
    addTaskQueueRole('printer');
    expect(readTaskQueueRoles()).toEqual(['printer']);
  });

  it('removes a role', () => {
    addTaskQueueRole('printer');
    addTaskQueueRole('grinder');
    removeTaskQueueRole('printer');
    expect(readTaskQueueRoles()).toEqual(['grinder']);
  });

  it('toggle adds when absent and returns true', () => {
    expect(toggleTaskQueueRole('printer')).toBe(true);
    expect(isTaskQueueRole('printer')).toBe(true);
  });

  it('toggle removes when present and returns false', () => {
    addTaskQueueRole('printer');
    expect(toggleTaskQueueRole('printer')).toBe(false);
    expect(isTaskQueueRole('printer')).toBe(false);
  });

  it('dispatches a change event on mutation', () => {
    const spy = vi.fn();
    window.addEventListener(TASK_QUEUES_EVENT, spy);
    addTaskQueueRole('printer');
    expect(spy).toHaveBeenCalledTimes(1);
    window.removeEventListener(TASK_QUEUES_EVENT, spy);
  });

  it('recognizes the three capability tiers as system roles', () => {
    expect(isSystemTierRole('superadmin')).toBe(true);
    expect(isSystemTierRole('admin')).toBe(true);
    expect(isSystemTierRole('engineer')).toBe(true);
    expect(isSystemTierRole('reviewer')).toBe(false);
    expect(isSystemTierRole('printer')).toBe(false);
  });

  it('ignores a corrupt stored value', () => {
    localStorage.setItem('lt:task-queues:roles', '{not json');
    expect(readTaskQueueRoles()).toEqual([]);
  });
});
