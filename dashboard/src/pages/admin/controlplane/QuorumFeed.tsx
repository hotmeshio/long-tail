import { useState } from 'react';
import { Radio } from 'lucide-react';
import { JsonViewer } from '../../../components/common/data/JsonViewer';
import { Collapsible } from '../../../components/common/layout/Collapsible';
import { EVENT_TYPE_COLORS, formatThrottleHuman, type QuorumEvent } from './helpers';

// ── Event row ───────────────────────────────────────────────────────────────

function QuorumEventRow({ event }: { event: QuorumEvent }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border-b border-surface-border/50 last:border-b-0">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 py-1.5 w-full text-left hover:bg-surface-hover/50 transition-colors"
      >
        <span className="text-[9px] font-mono text-text-tertiary whitespace-nowrap tabular-nums shrink-0">
          {new Date(event.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
        </span>
        <span className={`text-[9px] font-medium px-1 py-0.5 rounded ${EVENT_TYPE_COLORS[event.type] || 'text-text-tertiary'} bg-surface-sunken whitespace-nowrap shrink-0`}>
          {event.type}
        </span>
        <span className="text-[9px] text-text-tertiary font-mono flex-1 min-w-0 break-all">
          {event.data?.guid ? String(event.data.guid) : ''}
          {event.data?.topic ? ` ${String(event.data.topic)}` : ''}
          {event.type === 'throttle' ? ` → ${formatThrottleHuman(event.data?.throttle as number)}` : ''}
        </span>
        <svg
          className={`w-2.5 h-2.5 text-text-tertiary shrink-0 transition-transform duration-150 ${expanded ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      <Collapsible open={expanded}>
        <div className="pb-2">
          <JsonViewer data={event.data} />
        </div>
      </Collapsible>
    </div>
  );
}

// ── Feed panel ──────────────────────────────────────────────────────────────

interface QuorumFeedProps {
  events: QuorumEvent[];
  bridgeActive: boolean;
  onClear: () => void;
}

export function QuorumFeed({ events, bridgeActive, onClear }: QuorumFeedProps) {
  return (
    <div className="border-l border-surface-border pl-6 min-h-[300px] sticky top-14 self-start max-h-[calc(100vh-8rem)] flex flex-col">
      <div className="flex items-center gap-2 mb-4">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary">
          Quorum Feed
        </p>
        <Radio className={`w-3 h-3 ${bridgeActive ? 'text-status-success animate-pulse' : 'text-text-tertiary'}`} />
        <span className="text-[9px] text-text-tertiary">
          {bridgeActive ? 'Live' : '...'}
        </span>
        {events.length > 0 && (
          <button
            onClick={onClear}
            className="text-[9px] text-text-tertiary hover:text-text-primary ml-auto"
          >
            Clear
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        {events.length === 0 ? (
          <p className="text-xs text-text-tertiary py-6 text-center">
            {bridgeActive ? 'Waiting for quorum messages...' : 'Subscribing...'}
          </p>
        ) : (
          events.map((evt) => (
            <QuorumEventRow key={evt.id} event={evt} />
          ))
        )}
      </div>
    </div>
  );
}
