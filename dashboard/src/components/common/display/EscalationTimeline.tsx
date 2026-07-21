import { formatDurationCompact } from '../../../lib/format';
import { isEffectivelyClaimed } from '../../../lib/escalation';
import type { LTEscalationRecord } from '../../../api/types';

// Matches the palette used in EscalationTimeline (the spine view) and PaceChart.
// Hues resolve through the --lt-* status tokens so registered themes restyle
// the bar; the navy default keeps the sky/orange/green/red look.
const COLORS = {
  pending:   'rgb(var(--lt-status-queued-graphic))',  // sky blue  — waiting to be claimed
  claimed:   'rgb(var(--lt-status-claimed-graphic))', // orange    — actively being worked
  resolved:  'rgb(var(--lt-status-success-graphic))', // green     — done
  cancelled: 'rgb(var(--lt-status-error))',           // red       — cancelled or expired
} as const;

const BAR_H = 5; // px

/** A duration label tethered to a point on the bar by a thin vertical tick. */
function Marker({ pct, place, label, title, emphasis }: {
  pct: number;
  place: 'above' | 'below';
  label: string;
  title: string;
  emphasis?: boolean;
}) {
  const tick = <span className="w-px h-1.5 bg-text-quaternary" aria-hidden />;
  const text = (
    <span className={`whitespace-nowrap leading-none tabular-nums ${emphasis ? 'text-text-secondary' : 'text-text-tertiary'}`}>
      {label}
    </span>
  );
  return (
    <div
      title={title}
      className={`absolute ${place === 'above' ? 'bottom-0' : 'top-0'} flex flex-col items-center gap-0 -translate-x-1/2 cursor-help`}
      style={{ left: `${pct}%` }}
    >
      {place === 'above' ? <>{text}{tick}</> : <>{tick}{text}</>}
    </div>
  );
}

/**
 * Compact lifecycle sparkline for the escalation detail side panel.
 *
 * Bar segments: blue (pending — waiting to be claimed) → orange (claimed —
 * being worked) → green (resolved) or red (cancelled). Markers show
 * time-to-claim above the split point and total duration below the right edge.
 */
export function EscalationTimeline({ esc, className = '' }: { esc: LTEscalationRecord; className?: string }) {
  const created   = new Date(esc.created_at).getTime();
  const claimedAt = esc.claimed_at ? new Date(esc.claimed_at).getTime() : null;

  const isResolved  = esc.status === 'resolved';
  const isCancelled = esc.status === 'cancelled' || esc.status === 'expired';
  const isTerminal  = isResolved || isCancelled;
  const activeClaim = isEffectivelyClaimed(esc);

  const showClaimed = !!claimedAt && (activeClaim || isTerminal);

  const end = isResolved && esc.resolved_at
    ? new Date(esc.resolved_at).getTime()
    : isCancelled
      ? new Date(esc.updated_at).getTime()
      : Date.now();

  const total     = Math.max(end - created, 1);
  const pendingMs = showClaimed && claimedAt ? Math.max(claimedAt - created, 0) : total;
  const activeMs  = showClaimed && claimedAt ? Math.max(end - claimedAt, 0)     : 0;

  const pendingPct = Math.min(100, Math.max(0, (pendingMs / total) * 100));
  const activePct  = showClaimed ? Math.max(0, 100 - pendingPct) : 0;

  const activeColor = isResolved ? COLORS.resolved : isCancelled ? COLORS.cancelled : COLORS.claimed;
  const activeVerb  = isResolved ? 'Resolved after' : isCancelled ? 'Cancelled after' : 'In progress';

  const split    = formatDurationCompact(pendingMs);
  const totalStr = formatDurationCompact(total);
  const totalTip = isResolved
    ? `Resolved in ${totalStr} total`
    : isCancelled
      ? `Cancelled after ${totalStr}`
      : `Open ${totalStr} so far`;

  const legend = `Lifecycle bar: blue = time waiting to be claimed, ${isResolved ? 'green' : isCancelled ? 'red' : 'orange'} = ${activeVerb.toLowerCase()} the claim.`;

  return (
    <div className={className} title={legend}>
      {/* claim split label (above bar) */}
      <div className="relative h-3 text-2xs font-mono">
        {showClaimed && (
          <Marker
            pct={pendingPct}
            place="above"
            label={split}
            title={`Time to claim: ${split}`}
          />
        )}
      </div>

      {/* Bar track */}
      <div
        className="flex w-full rounded-full overflow-hidden"
        style={{ height: BAR_H, backgroundColor: 'rgb(var(--lt-surface-sunken))' }}
        title={legend}
      >
        {/* Pending (blue) */}
        <div
          style={{ width: `${pendingPct}%`, minWidth: BAR_H, backgroundColor: COLORS.pending, opacity: 0.75 }}
          title={`Waiting ${split} — created → claimed`}
        />
        {/* Claimed / resolved / cancelled */}
        {showClaimed && activePct > 0 && (
          <div
            style={{ width: `${activePct}%`, minWidth: BAR_H, backgroundColor: activeColor, opacity: 0.75 }}
            title={`${activeVerb} ${formatDurationCompact(activeMs)}`}
          />
        )}
      </div>

      {/* Total / age label (below bar, anchored at right edge) */}
      <div className="relative h-3 text-2xs font-mono">
        <Marker pct={100} place="below" emphasis label={totalStr} title={totalTip} />
      </div>
    </div>
  );
}
