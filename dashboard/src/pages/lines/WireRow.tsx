import { ArrowDownLeft, ArrowUpRight } from 'lucide-react';
import type { WireEvent } from '../../api/machines';
import { describeAction, formatClock, visibleActions, WIRE_VERB_TONE } from './wire-display';

/**
 * One line of the tape. At table width it is one row of columns: time,
 * direction, machine, channel and topic in mono, the summary, then the
 * violations and the actions the gateway took. Below it the row is a
 * dictionary: identity on the first line, the summary and the actions on
 * the second, the topic on the third.
 */
export function WireRow({ event, onOpen }: { event: WireEvent; onOpen: (event: WireEvent) => void }) {
  const actions = visibleActions(event.actions);
  const Direction = event.direction === 'in' ? ArrowDownLeft : ArrowUpRight;
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(event)}
        data-direction={event.direction}
        data-kind={event.kind}
        className="w-full text-left grid items-baseline gap-x-3 gap-y-0.5 px-2 py-1.5 border-b border-surface-border/60 hover:bg-surface-hover transition-colors
          grid-cols-[auto_auto_minmax(0,1fr)_auto]
          @table/tape:grid-cols-[auto_auto_6rem_11rem_minmax(0,1fr)_auto]"
      >
        <span className="text-2xs font-mono tabular-nums text-text-quaternary">{formatClock(event.at)}</span>
        <Direction
          className="w-3 h-3 self-center text-accent/65"
          aria-label={event.direction === 'in' ? 'in' : 'out'}
        />
        <span
          className="text-2xs font-mono text-text-primary min-w-0 truncate col-span-2 @table/tape:col-span-1"
          title={event.machineId ?? event.address ?? undefined}
        >
          {event.machineId ?? event.address ?? '—'}
        </span>
        <span
          className="text-2xs font-mono text-text-tertiary min-w-0 truncate col-start-3 col-span-2 @table/tape:col-start-4 @table/tape:col-span-1"
          title={`${event.channel} ${event.topic}`}
        >
          {event.channel}
          <span className="text-text-quaternary"> · </span>
          {event.topic}
        </span>
        <span
          className="text-xs text-text-secondary min-w-0 truncate col-start-3 @table/tape:col-start-5"
          title={event.summary}
        >
          {event.summary || `${event.kind}${event.event ? ` · ${event.event}` : ''}`}
        </span>
        <span className="min-w-0 max-w-[12rem] @table/tape:max-w-[22rem] truncate text-2xs col-start-4 @table/tape:col-start-6">
          {event.violations.length > 0 && (
            <span className="text-status-warning tabular-nums mr-2" title={event.violations.join('\n')}>
              {event.violations.length} violation{event.violations.length === 1 ? '' : 's'}
            </span>
          )}
          {actions.map((a, i) => (
            <span
              key={`${a.verb}-${a.rowId ?? ''}-${i}`}
              className={`${WIRE_VERB_TONE[a.verb] ?? 'text-text-secondary'} ${i < actions.length - 1 ? 'mr-2' : ''}`}
            >
              {describeAction(a)}
            </span>
          ))}
        </span>
      </button>
    </li>
  );
}
