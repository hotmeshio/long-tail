/**
 * Manual Task Queues list for canonical users (admin, superadmin). Scoped users
 * get their queues from membership; canonical users hand-pick roles to surface
 * in the sidebar, persisted here. Operators and engineers never touch this.
 *
 * A same-tab custom event ('lt:task-queues-changed') plus the native cross-tab
 * 'storage' event let the sidebar update live when a role is added or removed
 * from the role page — no reload.
 */

const TASK_QUEUES_KEY = 'lt:task-queues:roles';
export const TASK_QUEUES_EVENT = 'lt:task-queues-changed';

/** The three capability tiers are never work lanes — exclude them from membership. */
export const SYSTEM_TIER_ROLES = ['superadmin', 'admin', 'engineer'] as const;

export function isSystemTierRole(role: string): boolean {
  return (SYSTEM_TIER_ROLES as readonly string[]).includes(role);
}

export function readTaskQueueRoles(): string[] {
  try {
    const raw = localStorage.getItem(TASK_QUEUES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as unknown[]).filter((r): r is string => typeof r === 'string') : [];
  } catch {
    return [];
  }
}

function persist(roles: string[]): void {
  try {
    localStorage.setItem(TASK_QUEUES_KEY, JSON.stringify(roles));
  } catch {
    /* storage unavailable — best-effort */
  }
  try {
    window.dispatchEvent(new CustomEvent(TASK_QUEUES_EVENT));
  } catch {
    /* SSR / no window */
  }
}

export function isTaskQueueRole(role: string): boolean {
  return readTaskQueueRoles().includes(role);
}

export function addTaskQueueRole(role: string): void {
  const roles = readTaskQueueRoles();
  if (roles.includes(role)) return;
  persist([...roles, role].sort((a, b) => a.localeCompare(b)));
}

export function removeTaskQueueRole(role: string): void {
  const roles = readTaskQueueRoles();
  if (!roles.includes(role)) return;
  persist(roles.filter((r) => r !== role));
}

/** Add if absent, remove if present. Returns the new membership state. */
export function toggleTaskQueueRole(role: string): boolean {
  if (isTaskQueueRole(role)) {
    removeTaskQueueRole(role);
    return false;
  }
  addTaskQueueRole(role);
  return true;
}
