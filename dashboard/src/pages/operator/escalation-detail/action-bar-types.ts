import { type ShowIfContext } from '../../../lib/x-lt-show-if';
import { type FieldError } from '../../../lib/field-validator';
import { type FooterLabels } from '../../../lib/x-lt-labels';

// ---------------------------------------------------------------------------
// Action bar contract — the detail page drives the bar through these props.
// ---------------------------------------------------------------------------

export type ActionBarMode =
  | 'available'       // unclaimed — show claim controls
  | 'claimed_by_me'   // I own it — show resolve/release
  | 'claimed_by_other'// someone else has it
  | 'terminal';       // resolved or cancelled — nothing to do

export type ActiveView = 'resolve' | 'release';

export interface EscalationActionBarProps {
  mode: ActionBarMode;
  // Active view (controlled by parent)
  activeView: ActiveView;
  onActiveViewChange: (view: ActiveView) => void;
  // Claim
  onClaim: (minutes: number) => void;
  claimPending: boolean;
  /** Bumped when the user clicks the locked form — each bump replays the
   *  claim button's wiggle to point at the gesture that unlocks it. */
  claimNudge?: number;
  // Resolve — JSON lives in viewport, bar reads it for submit
  workflowType: string | null;
  json: string;
  onResolve: (payload: Record<string, unknown>) => void;
  resolvePending: boolean;
  resolveError: Error | null;
  // Triage (controlled by parent — callout + overlay render in page body)
  requestTriage: boolean;
  triageNotes: string;
  // Release
  onRelease: () => void;
  releasePending: boolean;
  // Cancel (opens confirm modal in parent)
  onCancel: () => void;
  // Other user
  assignedTo?: string | null;
  assignedUntil?: string | null;
  // Validation
  onSubmitAttempt?: () => void;
  /** Called with structured errors when submit is blocked by validation. */
  onValidationErrors?: (errors: FieldError[]) => void;
  /** Escalation context — used to skip required checks on fields hidden by x-lt-showIf. */
  escalationContext?: ShowIfContext;
  /** Footer copy overrides from the form's `x-lt-labels`. Absent targets keep their defaults. */
  labels?: FooterLabels;
  /** The page-owned x-lt-submit-guard block state — submit stays disabled while true. */
  submitBlocked?: boolean;
  /** Message shown beside the disabled submit while the guard blocks. */
  submitBlockedMessage?: string;
  /** The badged person's name when the claim is theirs (acting identity primed). */
  actingName?: string | null;
  /** At a scan station, the submit will require a badge scan as the claimant.
   *  Shows the up-front warning in place of the "Claimed by you" note. */
  submitNeedsBadge?: boolean;
  /** Admin/superadmin — surfaces the claim-override actions on claimed_by_other. */
  canManage?: boolean;
  /** Hand this claim to another user (opens the assign modal, takeover implied). */
  onReassign?: () => void;
  /** Return this claim to the available pool. */
  onUnassign?: () => void;
  unassignPending?: boolean;
}
