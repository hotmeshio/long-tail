import { useAuth } from './useAuth';
import { getViewAs } from '../lib/view-as';

/**
 * The four dashboard personas, ordered by breadth of access. The canonical set
 * (superadmin, admin) can see every role; the scoped set (engineer, operator)
 * sees only its own lanes.
 */
export type PersonaTier = 'superadmin' | 'admin' | 'engineer' | 'operator';

export interface Persona {
  /** Effective tier — the account tier, lowered by an active view-as override. */
  tier: PersonaTier;
  /** The real account tier, ignoring any view-as override. */
  realTier: PersonaTier;
  /** Active view-as override, or null when viewing your own tier. */
  viewAs: PersonaTier | null;
  /**
   * The Pace Board is a cross-role, sequenced view — it only means something to
   * someone who can see every role. Canonical tiers only.
   */
  canSeePaceBoard: boolean;
  /** Procedural + graph workflow execution surfaces. Builders only. */
  canSeeWorkflows: boolean;
  /**
   * The per-lane task-queue cards as the whole home page. This is the OPERATOR's
   * home only. Engineers are builders — they see the full builder home (minus
   * the Pace Board) and reach their task queues through the sidebar, by
   * membership. `canSeePaceBoard`/`canSeeWorkflows` gate the builder home.
   */
  showTaskQueueCards: boolean;
  /**
   * Where the sidebar's Task Queues section draws its roles from:
   * - `membership` — the roles the user belongs to (operator, engineer)
   * - `manual`     — a hand-curated list in localStorage (admin, superadmin)
   *
   * Keyed off the REAL tier: a canonical user previewing a lower role still
   * curates their own queues rather than inheriting non-existent memberships.
   */
  taskQueueSource: 'membership' | 'manual';
}

/**
 * Resolves the current user's persona, applying the view-as override the way
 * the settings panel and useAccess already do. This is the single source of
 * truth for which home-page layout and sidebar sections a user sees, so every
 * surface agrees and view-as previews stay consistent.
 */
export function usePersona(): Persona {
  const { isSuperAdmin, hasRoleType, hasRole } = useAuth();

  const realTier: PersonaTier = isSuperAdmin
    ? 'superadmin'
    : hasRoleType('admin')
      ? 'admin'
      : hasRole('engineer')
        ? 'engineer'
        : 'operator';

  const rawViewAs = getViewAs();
  const viewAs: PersonaTier | null =
    rawViewAs === 'admin' || rawViewAs === 'engineer' || rawViewAs === 'operator'
      ? rawViewAs
      : null;

  const tier: PersonaTier = viewAs ?? realTier;

  return {
    tier,
    realTier,
    viewAs,
    canSeePaceBoard: tier === 'superadmin' || tier === 'admin',
    canSeeWorkflows: tier === 'superadmin' || tier === 'engineer',
    showTaskQueueCards: tier === 'operator',
    taskQueueSource: realTier === 'superadmin' || realTier === 'admin' ? 'manual' : 'membership',
  };
}
