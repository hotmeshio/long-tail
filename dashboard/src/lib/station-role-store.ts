/**
 * Per-device station queue selection. A readonly kiosk account that is a member
 * of several roles picks which role is its home/kiosk queue; the choice is held
 * in localStorage keyed by userId so a shared iPad remembers its station across
 * reloads and account switches. This is a view/home selection only — it never
 * changes read scope (scans still span every member role) or write privilege.
 */

import { useSyncExternalStore } from 'react';

const KEY_PREFIX = 'lt:station:kiosk-role:';

function storageKey(userId: string): string {
  return `${KEY_PREFIX}${userId}`;
}

const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

export function getSelectedRole(userId: string): string | null {
  try {
    return localStorage.getItem(storageKey(userId));
  } catch {
    return null;
  }
}

export function setSelectedRole(userId: string, role: string | null): void {
  try {
    if (role === null) localStorage.removeItem(storageKey(userId));
    else localStorage.setItem(storageKey(userId), role);
  } catch {
    /* storage unavailable — selection is best-effort */
  }
  notify();
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key.startsWith(KEY_PREFIX)) listener();
  };
  try {
    window.addEventListener('storage', onStorage);
  } catch {
    /* no window — subscribe still tracks in-process changes */
  }
  return () => {
    listeners.delete(listener);
    try {
      window.removeEventListener('storage', onStorage);
    } catch {
      /* no window */
    }
  };
}

/** React binding: the selected station role for a user, reactive to changes. */
export function useStationRole(userId: string | null): string | null {
  return useSyncExternalStore(
    subscribe,
    () => (userId ? getSelectedRole(userId) : null),
  );
}
