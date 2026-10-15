import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Search } from 'lucide-react';
import type { HelpTokenContext } from '../../../lib/x-lt-help';
import { STATUS_DOT_STYLES } from '../../common/display/StatusBadge';
import { useClaimEscalation } from '../../../api/escalations';
import { isEffectivelyClaimed } from '../../../lib/escalation';
import { identifierToTitle } from '../../../lib/identifier-label';
import type { RefinePair } from '../RefineDialog';
import type { LTEscalationRecord } from '../../../api/types';

/** The row-level pieces every list layout shares: column and action
 *  declarations, the row's token context, the row action, and refine. */

/** Dot colour matches the standard table view: blue = pending unclaimed,
 * orange = under a live claim; other statuses follow the shared map. */
export function escalationDotClass(e: LTEscalationRecord): string {
  if (e.status === 'pending') {
    return isEffectivelyClaimed(e) ? 'bg-status-claimed-graphic' : 'bg-status-active';
  }
  return STATUS_DOT_STYLES[e.status] ?? 'bg-status-active';
}

export interface ColumnDef {
  label: string;
  value: string;
  /** "age" renders an ISO timestamp as a compact age with an absolute tooltip. */
  format?: string;
  /**
   * Card-fold behavior when the table folds at narrow widths (same contract
   * as the engineer table): 1 = identity — always visible, forms the card's
   * title line; 2 = folds into the card body as a label/value pair; 3 =
   * dropped in card mode. Undeclared, the first column is the identity and
   * the rest fold.
   */
  priority?: 1 | 2 | 3;
  /** CSS column width ("40%", "12rem"). Unset columns share the remainder;
   *  when no column declares one, the first column holds a fixed 200px so
   *  the identity stays legible and every other value keeps its room. */
  width?: string;
}

/**
 * The per-row action button — the queue-working gesture, always available on
 * every layout. Template-driven: the schema author sets the action, its text,
 * and (for claim) the hold time.
 */
export interface RowActionDef {
  /** "claim" fires a one-click claim then opens the detail page already
   *  claimed; "view" just opens it. Default "claim". */
  action?: 'claim' | 'view';
  /** Button text. Defaults "Claim" / "View" by action. */
  label?: string;
  /** Claim hold time in minutes. Default 30 (the platform claim default). */
  durationMinutes?: number;
  /**
   * Launch the detail page's claim-and-submit flow instead of a plain claim:
   * the row is claimed, the form's seeded defaults are resolved, and — when the
   * form declares `x-lt-transition` — the wait screen bridges to the born-assigned
   * follow-on. One list gesture ("Start Harvesting") starts the work and lands
   * the person on the next step. The behavior lives on the detail page (form
   * defaults, validation, transition); the list only points there with intent.
   */
  submitOnClaim?: boolean;
}

/** Build the token context for one escalation row (payloads are JSON strings). */
export function rowContext(e: LTEscalationRecord): HelpTokenContext {
  const parse = (s: string | null | undefined): Record<string, unknown> | null => {
    if (!s) return null;
    try {
      const v = JSON.parse(s);
      return v && typeof v === 'object' ? v : null;
    } catch {
      return null;
    }
  };
  return {
    escalation: e as unknown as Record<string, unknown>,
    metadata: e.metadata ?? null,
    envelope: parse(e.envelope),
    payload: parse(e.escalation_payload),
    resolver: parse(e.resolver_payload),
  };
}

/** The identity column's width when no column declares one: room for a label, no more. */
export const IDENTITY_COLUMN_WIDTH = '200px';

/** The action column sizes to its label so the button never wraps or truncates. */
export function actionColumnWidth(label: string): string {
  return `${Math.max(6, Math.round(label.length * 0.55 + 3.5))}rem`;
}

const DEFAULT_CLAIM_MINUTES = 30;

/** Claim targets pending rows without a live claim window. */
function isClaimable(row: LTEscalationRecord): boolean {
  return row.status === 'pending' && !isEffectivelyClaimed(row);
}

/**
 * The x-lt-row-action button. `claim` is one click: claim for the template's
 * duration, then open the detail page already claimed — the fast path for
 * working a queue. `view` opens the detail page. Persistent (light accent at
 * rest, saturating on hover); a rejected claim surfaces its message inline.
 */
export function RowActionButton({ row, def, onView, prominent, forceView }: {
  row: LTEscalationRecord;
  def?: RowActionDef;
  onView?: () => void;
  /** Hero treatment for the active-card CTA; default is the compact row button. */
  prominent?: boolean;
  /** Render claim templates as view actions (see EscalationListView). */
  forceView?: boolean;
}) {
  const authored = def?.action ?? 'claim';
  const action = forceView ? 'view' : authored;
  // The authored label describes the authored gesture. When view is forced
  // over a claim template, claim wording would mislead — use the view default.
  const label = authored === action && def?.label
    ? def.label
    : action === 'claim' ? 'Claim' : 'View';
  const claim = useClaimEscalation();
  const navigate = useNavigate();
  const location = useLocation();
  const [error, setError] = useState('');

  // A spent gesture stays visible — the disabled button keeps every row's
  // layout uniform instead of leaving a hole on resolved/held rows.
  const spent = action === 'claim' && !isClaimable(row);

  const fire = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (action === 'view') {
      onView?.();
      return;
    }
    // Launch the detail page's claim → submit → transition flow. The detail
    // page owns the heavy lifting (seed defaults, validate, resolve, hand-off);
    // the list points there with the intent and the authored claim duration.
    if (def?.submitOnClaim) {
      navigate(`/escalations/detail/${row.id}`, {
        state: { autoStart: true, durationMinutes: def?.durationMinutes, from: location.pathname },
      });
      return;
    }
    setError('');
    claim.mutate(
      { id: row.id, durationMinutes: def?.durationMinutes ?? DEFAULT_CLAIM_MINUTES },
      {
        onSuccess: () => onView?.(),
        onError: (err) => setError((err as Error).message),
      },
    );
  };

  const classes = prominent
    ? 'btn-primary text-xs shrink-0 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-accent'
    : 'px-2 py-0.5 rounded text-2xs font-medium text-accent/70 border border-accent/30 enabled:hover:text-accent enabled:hover:border-accent/60 enabled:hover:bg-accent/5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap';

  return (
    <span className="inline-flex flex-col items-end gap-0.5">
      <button
        type="button"
        onClick={fire}
        disabled={claim.isPending || spent}
        title={spent ? (row.status === 'pending' ? 'claimed' : row.status) : undefined}
        className={classes}
        data-testid="row-action-button"
      >
        {claim.isPending ? 'Claiming…' : label}
      </button>
      {error && <span className="text-2xs text-status-error" data-testid="row-action-error">{error}</span>}
    </span>
  );
}

/** A field value token that is a pure metadata binding — facet-linkable. */
export const METADATA_TOKEN = /^\{\{\s*metadata\.([a-zA-Z0-9_]+)\s*\}\}$/;

/** A metadata value the faceted query can match on: a scalar with something in it. */
function isFacetValue(raw: unknown): raw is string | number | boolean {
  return (typeof raw === 'string' && raw !== '') || typeof raw === 'number' || typeof raw === 'boolean';
}

/**
 * The refinable facts one row offers: every metadata facet the row carries.
 * Columns the author bound to a metadata value lead, under their authored
 * labels; every other scalar facet follows under a label derived from its
 * key, so the dialog reaches the whole record, not only what the columns
 * show. Feeds the row's RefineDialog.
 */
export function rowRefinePairs(row: LTEscalationRecord, columnDefs: ColumnDef[]): RefinePair[] {
  const pairs: RefinePair[] = [];
  const seen = new Set<string>();
  const metadata = row.metadata ?? {};
  for (const col of columnDefs) {
    const bound = typeof col.value === 'string' ? col.value.match(METADATA_TOKEN)?.[1] : undefined;
    if (!bound || seen.has(bound)) continue;
    const raw = metadata[bound];
    if (!isFacetValue(raw)) continue;
    seen.add(bound);
    pairs.push({ key: bound, label: col.label, value: raw, bound: true });
  }
  for (const [key, raw] of Object.entries(metadata)) {
    if (seen.has(key) || !isFacetValue(raw)) continue;
    seen.add(key);
    pairs.push({ key, label: identifierToTitle(key), value: raw });
  }
  return pairs;
}

/** The always-tappable row/card refine trigger — one magnifier, dialog behind it. */
export function RefineTrigger({ onOpen, className = '' }: { onOpen: () => void; className?: string }) {
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onOpen(); }}
      className={`p-1.5 rounded text-text-quaternary/70 hover:text-accent hover:bg-surface-hover transition-colors ${className}`}
      title="Refine — filter or search by this row's values"
      aria-label="Refine — filter or search by this row's values"
      data-testid="row-refine"
    >
      <Search className="w-3.5 h-3.5" strokeWidth={1.5} />
    </button>
  );
}
