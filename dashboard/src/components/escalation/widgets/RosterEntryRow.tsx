import { CheckCircle2, Circle, Flag } from 'lucide-react';
import { OpenDetailButton } from './OpenDetailButton';
import { InlineConfirm } from './InlineConfirm';
import { interpolateHelp } from '../../../lib/x-lt-help';
import { interpolateItemTemplate, type EscalationItem } from '../../../lib/escalation-items';
import { renderEmbedValue, type EmbedActionDef, type EmbedColumnDef } from '../../../lib/embed-row';
import { ROSTER_STATES, type RosterEntry, type RosterState } from '../../../lib/x-lt-roster';
import type { ShowIfContext } from '../../../lib/x-lt-show-if';

/** A roster action: a canned resolve of the entry's member row, offered in the states it names. */
export interface RosterActionDef extends EmbedActionDef {
  /** The entry states that offer it; default `waiting`. */
  when?: RosterState | RosterState[];
}

const STATE_TEXT: Record<RosterState, string> = { waiting: 'Waiting', in: 'In', flagged: 'Flagged' };

function offers(action: RosterActionDef, state: RosterState): boolean {
  const when = action.when ?? ROSTER_STATES.WAITING;
  return Array.isArray(when) ? when.includes(state) : when === state;
}

function StateMark({ state }: { state: RosterState }) {
  if (state === ROSTER_STATES.IN) return <CheckCircle2 className="w-4 h-4 text-status-success shrink-0" strokeWidth={2} aria-hidden />;
  if (state === ROSTER_STATES.FLAGGED) return <Flag className="w-4 h-4 text-status-warning shrink-0" strokeWidth={2} aria-hidden />;
  return <Circle className="w-4 h-4 text-text-tertiary shrink-0" strokeWidth={2} aria-hidden />;
}

/**
 * One roster entry: its state mark, columns, state label, and the actions
 * its state offers. Columns read the member row's domains (a query set) or
 * the host row's, beside `{{item.*}}`: the entry key, a batch label, and
 * the held item's payload, actor and arrival time once it is in.
 */
export function RosterEntryRow({
  entry, item, hostCtx, columns, actions, confirming, pending, error, onAction, onConfirm, onCancel,
}: {
  entry: RosterEntry;
  item: EscalationItem & { label?: unknown };
  hostCtx: ShowIfContext;
  columns: EmbedColumnDef[];
  actions: RosterActionDef[];
  confirming: RosterActionDef | null;
  pending: boolean;
  error?: string;
  onAction: (action: RosterActionDef) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const ctx = entry.row ?? hostCtx;
  const offered = entry.row ? actions.filter((a) => offers(a, entry.state)) : [];
  const done = entry.state === ROSTER_STATES.IN;
  const stateLabel = entry.state === ROSTER_STATES.FLAGGED ? entry.flag ?? STATE_TEXT.flagged : STATE_TEXT[entry.state];

  return (
    <li
      className="py-2 flex items-start gap-3 border-b border-surface-border/50 last:border-0"
      data-testid={`roster-entry-${entry.key}`}
      data-state={entry.state}
    >
      <span className="pt-0.5"><StateMark state={entry.state} /></span>
      <div className="min-w-0 flex-1 flex flex-wrap items-baseline gap-x-4 gap-y-0.5">
        {columns.map((col) => (
          <span key={col.label} className={`text-sm min-w-0 ${done ? 'text-text-secondary' : 'text-text-primary'}`}>
            <span className="sr-only">{col.label}: </span>
            {renderEmbedValue(interpolateItemTemplate(col.value, item, ctx), col.format)}
          </span>
        ))}
      </div>
      <span
        className={`text-xs font-medium shrink-0 pt-0.5 ${done ? 'text-status-success' : entry.state === ROSTER_STATES.FLAGGED ? 'text-status-warning' : 'text-text-tertiary'}`}
        data-testid={`roster-state-${entry.key}`}
      >
        {stateLabel}
      </span>
      {(offered.length > 0 || confirming) && (
        <span className="shrink-0 flex flex-col items-end gap-0.5">
          {confirming ? (
            <InlineConfirm
              message={interpolateHelp(confirming.confirm ?? '', ctx)}
              onConfirm={onConfirm}
              onCancel={onCancel}
              testId={`roster-confirm-${entry.key}`}
            />
          ) : (
            <span className="flex gap-1">
              {offered.map((action) => (
                <button
                  key={action.label}
                  type="button"
                  onClick={() => onAction(action)}
                  disabled={pending}
                  className="px-2 py-0.5 text-2xs font-medium text-accent border border-accent/40 rounded hover:bg-accent/10 disabled:opacity-40 disabled:cursor-default transition-colors"
                  data-testid={`roster-action-${entry.key}`}
                >
                  {action.label}
                </button>
              ))}
            </span>
          )}
          {error && (
            <span className="text-2xs text-status-error max-w-[16rem] text-right" data-testid={`roster-error-${entry.key}`}>{error}</span>
          )}
        </span>
      )}
      {entry.row && (
        <OpenDetailButton to={`/escalations/detail/${String(entry.row.escalation.id)}`} />
      )}
    </li>
  );
}
