import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getSelectedRole, setSelectedRole, subscribe } from '../station-role-store';

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('station-role-store', () => {
  it('returns null when nothing is selected', () => {
    expect(getSelectedRole('u1')).toBeNull();
  });

  it('persists and reads a selection to localStorage', () => {
    setSelectedRole('u1', 'gluer');
    expect(getSelectedRole('u1')).toBe('gluer');
    expect(localStorage.getItem('lt:station:kiosk-role:u1')).toBe('gluer');
  });

  it('isolates selections per userId', () => {
    setSelectedRole('u1', 'gluer');
    setSelectedRole('u2', 'packer');
    expect(getSelectedRole('u1')).toBe('gluer');
    expect(getSelectedRole('u2')).toBe('packer');
  });

  it('clears a selection when set to null', () => {
    setSelectedRole('u1', 'gluer');
    setSelectedRole('u1', null);
    expect(getSelectedRole('u1')).toBeNull();
  });

  it('notifies subscribers on change and stops after unsubscribe', () => {
    const listener = vi.fn();
    const unsubscribe = subscribe(listener);
    setSelectedRole('u1', 'gluer');
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    setSelectedRole('u1', 'packer');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('falls back to null when localStorage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('unavailable');
    });
    expect(getSelectedRole('u1')).toBeNull();
  });
});
