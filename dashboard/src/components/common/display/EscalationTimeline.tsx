import { formatDurationCompact } from '../../../lib/format';
import { isEffectivelyClaimed } from '../../../lib/escalation';
import type { LTEscalationRecord } from '../../../api/types';

const BAR_H = 4; // px — also the minimum segment width, so tiny segments render as a sphere

/** A duration label tethered to a point on the bar by a thin vertical line. */
function Marker({ pct, place, label, title, emphasis }: {
  pct: number;
  place: 'above' | 'below';
  label: string;
  title: string;
  emphasis?: boolean;
}) {
  const line = <span className="w-px h-1 bg-surface-border" aria-hidden />;
  const text = (
    <span className={`whitespace-nowrap leading-none ${emphasis ? 'text-text-secondary' : 'text-text-tertiary'}`}>
      {label}
    </span>
  );
  return (
    <div
      // title on the whole marker so hovering either the label or its line explains it
      title={title}
      className={`absolute ${place === 'above' ? 'bottom-0' : 'top-0'} flex flex-col items-center gap-0 -translate-x-1/2 cursor-help`}
      style={{ left: `${pct}%` }}
    >
      {place === 'above' ? <>{text}{line}</> : <>{line}{text}</>}
    </div>
  );
}

/**
 * A compact lifecycle sparkline. The bar shows the share of an escalation's life
 * spent **waiting** (created → claimed, amber) versus the claim outcome —
 * **in progress** (blue) while a claim is live, **resolved** (green), or
 * **cancelled** (red). A timed-out claim on a still-open escalation reverts to
 * all-waiting (amber). A segment never renders thinner than the bar height, so a
 * sliver of work still reads as a sphere. The time-to-claim label tethers above
 * the split; the total/age tethers below, centered on the right edge.
 */
export function EscalationTimeline({ esc, className = '' }: { esc: LTEscalationRecord; className?: string }) {
  const created = new Date(esc.created_at).getTime();
  const claimedAt = esc.claimed_at ? new Date(esc.claimed_at).getTime() : null;

  const isResolved = esc.status === 'resolved';
  const isCancelled = esc.status === 'cancelled';
  const isTerminal = isResolved || isCancelled;
  const activeClaim = isEffectivelyClaimed(esc);

  const showSecond = !!claimedAt && (activeClaim || isTerminal);

  const end = isResolved && esc.resolved_at
    ? new Date(esc.resolved_at).getTime()
    : isCancelled
      ? new Date(esc.updated_at).getTime()
      : Date.now();

  const total = Math.max(end - created, 1);
  const splitMs = showSecond && claimedAt ? Math.max(claimedAt - created, 0) : total;
  const secondMs = showSecond && claimedAt ? Math.max(end - claimedAt, 0) : 0;
  const waitPct = Math.min(100, Math.max(0, (splitMs / total) * 100));
  const secondPct = showSecond ? Math.max(0, 100 - waitPct) : 0;

  const secondClass = isResolved ? 'bg-status-success' : isCancelled ? 'bg-status-error' : 'bg-status-active';
  const secondVerb = isResolved ? 'Worked' : isCancelled ? 'Open before cancel' : 'In progress';
  const split = formatDurationCompact(splitMs);
  const totalStr = formatDurationCompact(total);
  const totalTip = isResolved ? `Resolved in ${totalStr} total`
    : isCancelled ? `Cancelled after ${totalStr}`
    : `Open ${totalStr} so far (current age)`;
  const legend = `Lifecycle: amber = time spent waiting to be claimed, the colored end = ${secondVerb.toLowerCase()} after the claim. Top label is time-to-claim, bottom is total time.`;

  return (
    <div className={className} title={legend}>
      {/* claim marker (above) */}
      <div className="relative h-2.5 text-[9px] font-mono">
        {showSecond && (
          <Marker pct={waitPct} place="above" label={split} title={`Time to claim: ${split} (created → claimed)`} />
        )}
      </div>

      <div className="flex w-full rounded-full overflow-hidden bg-surface-sunken cursor-help" style={{ height: BAR_H }} title={legend}>
        <div
          style={{ width: `${waitPct}%`, minWidth: BAR_H }}
          className="bg-status-pending"
          title={`Waiting ${split} — created → claimed`}
        />
        {showSecond && (
          <div
            style={{ width: `${secondPct}%`, minWidth: BAR_H }}
            className={secondClass}
            title={`${secondVerb} ${formatDurationCompact(secondMs)} — claimed → ${isResolved ? 'resolved' : isCancelled ? 'cancelled' : 'now'}`}
          />
        )}
      </div>

      {/* total / age marker (below, centered on the right edge) */}
      <div className="relative h-2.5 text-[9px] font-mono">
        <Marker pct={100} place="below" emphasis label={totalStr} title={totalTip} />
      </div>
    </div>
  );
}
