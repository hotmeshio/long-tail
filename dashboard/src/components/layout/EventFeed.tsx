import { useState, useCallback, useRef, useEffect } from 'react';
import { ChevronUp, ChevronDown, Eraser } from 'lucide-react';
import { useEventSubscription } from '../../hooks/useEventContext';
import { JsonViewer } from '../common/data/JsonViewer';
import { Collapsible } from '../common/layout/Collapsible';

const MAX_EVENTS = 100;
const DEDUP_WINDOW_MS = 500;
let counter = 0;

interface FeedEvent {
  id: number;
  type: string;
  timestamp: string;
  data: Record<string, unknown>;
}

const TYPE_COLORS: Record<string, string> = {
  'escalation.created': 'text-status-warning',
  'escalation.claimed': 'text-blue-400',
  'escalation.released': 'text-text-tertiary',
  'escalation.resolved': 'text-status-success',
  'task.created': 'text-accent',
  'task.completed': 'text-status-success',
  'task.failed': 'text-status-error',
  'task.escalated': 'text-status-warning',
  'workflow.started': 'text-accent',
  'workflow.completed': 'text-status-success',
  'workflow.failed': 'text-status-error',
  'activity.started': 'text-blue-400',
  'activity.completed': 'text-status-success',
  'activity.failed': 'text-status-error',
  milestone: 'text-violet-400',
};

function EventRow({ event }: { event: FeedEvent }) {
  const [expanded, setExpanded] = useState(false);
  const color = TYPE_COLORS[event.type] || 'text-text-tertiary';

  return (
    <div className="border-b border-surface-border/30 last:border-b-0">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 py-1 w-full text-left hover:bg-surface-hover/50 transition-colors px-3"
      >
        <span className="text-[9px] font-mono text-text-tertiary whitespace-nowrap tabular-nums shrink-0">
          {new Date(event.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
        </span>
        <span className={`text-[9px] font-medium px-1 py-0.5 rounded ${color} bg-surface-sunken whitespace-nowrap shrink-0`}>
          {event.type}
        </span>
        <span className="text-[9px] text-text-tertiary font-mono flex-1 min-w-0 truncate">
          {event.data?.workflowId ? String(event.data.workflowId) : ''}
          {event.data?.escalationId ? ` esc:${String(event.data.escalationId).slice(0, 12)}` : ''}
        </span>
        <svg
          className={`w-2.5 h-2.5 text-text-tertiary shrink-0 transition-transform duration-150 ${expanded ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      <Collapsible open={expanded}>
        <div className="pb-2 px-3">
          <JsonViewer data={event.data} />
        </div>
      </Collapsible>
    </div>
  );
}

export function EventFeed({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const [events, setEvents] = useState<FeedEvent[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const recentRef = useRef<Map<string, number>>(new Map());

  useEventSubscription('lt.events.>', useCallback((raw: any) => {
    const type = String(raw.type || 'unknown');
    if (type.startsWith('mesh.')) return;

    // Deduplicate: same type+timestamp within window (StrictMode double-mount)
    const fingerprint = `${type}:${raw.timestamp || ''}:${raw.escalationId || raw.workflowId || raw.taskId || ''}`;
    const now = Date.now();
    const lastSeen = recentRef.current.get(fingerprint);
    if (lastSeen && now - lastSeen < DEDUP_WINDOW_MS) return;
    recentRef.current.set(fingerprint, now);

    // Prune old fingerprints periodically
    if (recentRef.current.size > 200) {
      for (const [key, ts] of recentRef.current) {
        if (now - ts > DEDUP_WINDOW_MS * 2) recentRef.current.delete(key);
      }
    }

    setEvents((prev) => {
      const next = [{
        id: ++counter,
        type,
        timestamp: raw.timestamp || new Date().toISOString(),
        data: raw,
      }, ...prev];
      return next.slice(0, MAX_EVENTS);
    });
  }, []));

  // Auto-scroll to top on new events when open
  useEffect(() => {
    if (open && scrollRef.current) {
      scrollRef.current.scrollTop = 0;
    }
  }, [events.length, open]);

  return (
    <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-surface-border bg-surface-raised">
      {/* Toggle bar */}
      <button
        onClick={onToggle}
        className="flex items-center gap-2 w-full px-4 py-1.5 text-left hover:bg-surface-hover transition-colors"
      >
        {open ? <ChevronDown className="w-3 h-3 text-text-tertiary" /> : <ChevronUp className="w-3 h-3 text-text-tertiary" />}
        <span className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary">
          Event Stream
        </span>
        {events.length > 0 && (
          <span className="text-[9px] text-text-tertiary">
            {events.length} events
          </span>
        )}
        {events.length > 0 && !open && (
          <span className={`text-[9px] font-medium px-1 py-0.5 rounded ${TYPE_COLORS[events[0].type] || 'text-text-tertiary'} bg-surface-sunken`}>
            {events[0].type}
          </span>
        )}
        {events.length > 0 && (
          <span
            className="ml-auto text-text-tertiary hover:text-text-primary p-0.5"
            title="Clear events"
            onClick={(e) => { e.stopPropagation(); setEvents([]); }}
          >
            <Eraser className="w-3 h-3" />
          </span>
        )}
      </button>

      {/* Event list */}
      <Collapsible open={open}>
        <div ref={scrollRef} className="h-48 overflow-y-auto">
          {events.length === 0 ? (
            <p className="text-[10px] text-text-tertiary py-4 text-center">Waiting for events...</p>
          ) : (
            events.map((evt) => <EventRow key={evt.id} event={evt} />)
          )}
        </div>
      </Collapsible>
    </div>
  );
}
