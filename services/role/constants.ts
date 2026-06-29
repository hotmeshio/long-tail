/** Runtime constants for the role surface. No magic strings at call sites. */

/**
 * How a role lands when opened — its `home_view`. A role is both a queue and a
 * view, so the row itself declares which face to show:
 * - `queue`    → the escalation list (the default when unset)
 * - `overview` → the time-series attainment overview
 */
export const ROLE_HOME_VIEWS = {
  QUEUE: 'queue',
  OVERVIEW: 'overview',
} as const;

export type RoleHomeView = (typeof ROLE_HOME_VIEWS)[keyof typeof ROLE_HOME_VIEWS];

/** The home_view used when a role has not declared one. */
export const DEFAULT_HOME_VIEW: RoleHomeView = ROLE_HOME_VIEWS.QUEUE;

export function isRoleHomeView(value: unknown): value is RoleHomeView {
  return value === ROLE_HOME_VIEWS.QUEUE || value === ROLE_HOME_VIEWS.OVERVIEW;
}
