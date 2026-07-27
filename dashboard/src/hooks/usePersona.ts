import { useAuth } from './useAuth';
import { useSettings } from '../api/settings';
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
   * The Pace Board is aggregate counts and trends — readable by every login
   * while the deployment's publicPaceBoard feature (default on) stands. With
   * the flag off it narrows to the canonical tiers (superadmin, admin), whose
   * membership spans every role.
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
}

/**
 * Resolves the current user's persona, applying the view-as override the way
 * the settings panel and useAccess already do. This is the single source of
 * truth for which home-page layout and sidebar sections a user sees, so every
 * surface agrees and view-as previews stay consistent.
 */
export function usePersona(): Persona {
  const { isSuperAdmin, hasRoleType, hasRole } = useAuth();
  const { data: settings } = useSettings();
  // Default-on: the board narrows only when the deployment explicitly opts out.
  const publicPaceBoard = settings?.features?.publicPaceBoard !== false;

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
    canSeePaceBoard: publicPaceBoard || tier === 'superadmin' || tier === 'admin',
    canSeeWorkflows: tier === 'superadmin' || tier === 'engineer',
    // With the board public, everyone's home is the admin layout (board on
    // top, escalation panels below); the per-lane cards home remains the
    // operator's when the deployment scopes the board back down.
    showTaskQueueCards: tier === 'operator' && !publicPaceBoard,
  };
}
