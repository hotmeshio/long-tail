import { useState, useCallback, useRef, useEffect, useContext } from 'react';
import { ChevronUp, ChevronDown, Eraser, Maximize2, Minimize2, Settings2, X, Plus } from 'lucide-react';
import { EventContext } from '../../hooks/useEventContext';
import { useEventFeedPatterns } from '../../hooks/useEventFeedPatterns';
import { JsonViewer } from '../common/data/JsonViewer';
import { Collapsible } from '../common/layout/Collapsible';
import { FullscreenOverlay } from '../common/layout/FullscreenOverlay';

const MAX_EVENTS = 100;
const DEDUP_WINDOW_MS = 500;
let counter = 0;

interface FeedEvent {
  id: number;
  type: string;
  timestamp: string;
  data: Record<string, unknown>;
}

// Color by {category}.{action} — extracted from structured subjects like
// system.workflow.abc123.completed → workflow.completed
const TYPE_COLORS: Record<string, string> = {
  'escalation.created': 'text-blue-400',
  'escalation.claimed': 'text-status-warning',
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
  'knowledge.stored': 'text-violet-400',
  'knowledge.deleted': 'text-text-tertiary',
  'agent.started': 'text-accent',
  'agent.completed': 'text-status-success',
  'agent.failed': 'text-status-error',
  'agent.status_changed': 'text-blue-400',
  milestone: 'text-violet-400',
};

/** Extract {category}.{action} from a structured event type for color lookup. */
function eventColorKey(type: string): string {
  // system.workflow.abc123.completed → workflow.completed
  const parts = type.split('.');
  if (parts[0] === 'system' && parts.length >= 3) {
    return `${parts[1]}.${parts[parts.length - 1]}`;
  }
  return type;
}

function EventRow({ event, forceExpanded = false }: { event: FeedEvent; forceExpanded?: boolean }) {
  const [expanded, setExpanded] = useState(forceExpanded);
  const color = TYPE_COLORS[eventColorKey(event.type)] || 'text-text-tertiary';

  // Sync with parent-driven expand/collapse
  useEffect(() => { setExpanded(forceExpanded); }, [forceExpanded]);

  const isFullsize = forceExpanded;
  const timeSize = isFullsize ? 'text-xs' : 'text-[9px]';
  const typeSize = isFullsize ? 'text-xs' : 'text-[9px]';
  const idSize = isFullsize ? 'text-xs' : 'text-[9px]';
  const chevronSize = isFullsize ? 'w-3.5 h-3.5' : 'w-2.5 h-2.5';
  const rowPad = isFullsize ? 'py-2 px-4' : 'py-1 px-3';
  const detailPad = isFullsize ? 'pb-4 px-4' : 'pb-2 px-3';

  return (
    <div className="border-b border-surface-border/30 last:border-b-0">
      <button
        onClick={() => setExpanded(!expanded)}
        className={`flex items-center gap-2 ${rowPad} w-full text-left hover:bg-surface-hover/50 transition-colors`}
      >
        <span className={`${timeSize} font-mono text-text-tertiary whitespace-nowrap tabular-nums shrink-0`}>
          {new Date(event.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
        </span>
        <span className={`${typeSize} font-medium px-1 py-0.5 rounded ${color} bg-surface-sunken whitespace-nowrap shrink-0`}>
          {event.type}
        </span>
        <span className={`${idSize} text-text-tertiary font-mono flex-1 min-w-0 truncate`}>
          {event.data?.workflowId ? String(event.data.workflowId) : ''}
          {event.data?.escalationId ? ` esc:${String(event.data.escalationId).slice(0, 12)}` : ''}
        </span>
        <svg
          className={`${chevronSize} text-text-tertiary shrink-0 transition-transform duration-150 ${expanded ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      <Collapsible open={expanded}>
        <div className={detailPad}>
          <JsonViewer data={event.data} />
        </div>
      </Collapsible>
    </div>
  );
}

export function EventFeed({ open, onToggle, configOpen, onToggleConfig }: { open: boolean; onToggle: () => void; configOpen: boolean; onToggleConfig: () => void }) {
  const [events, setEvents] = useState<FeedEvent[]>([]);
  const [fullscreen, setFullscreen] = useState(false);
  const [newPattern, setNewPattern] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const recentRef = useRef<Map<string, number>>(new Map());
  const { subscribe } = useContext(EventContext);
  const { patterns, pagePattern, userPatterns, addPattern, removePattern } = useEventFeedPatterns();

  const handler = useCallback((raw: any) => {
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
  }, []);

  // Subscribe to all active patterns — cleanup on pattern change
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  useEffect(() => {
    const unsubs = patterns.map((p) => subscribe(p, (e) => handlerRef.current(e)));
    return () => unsubs.forEach((u) => u());
  }, [subscribe, patterns.join(',')]);

  // Auto-scroll to top on new events when open
  useEffect(() => {
    if (open && scrollRef.current) {
      scrollRef.current.scrollTop = 0;
    }
  }, [events.length, open]);

  return (
    <div className="shrink-0 border-t border-surface-border bg-surface-raised">
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
          <span className={`text-[9px] font-medium px-1 py-0.5 rounded ${TYPE_COLORS[eventColorKey(events[0].type)] || 'text-text-tertiary'} bg-surface-sunken`}>
            {events[0].type}
          </span>
        )}
        <span className="ml-auto flex items-center gap-1">
          <span
            className={`p-0.5 cursor-pointer ${configOpen ? 'text-accent' : 'text-text-tertiary hover:text-text-primary'}`}
            title="Subscription config"
            onClick={(e) => { e.stopPropagation(); onToggleConfig(); }}
          >
            <Settings2 className="w-3 h-3" />
          </span>
          {events.length > 0 && (
            <>
              <span
                className="text-text-tertiary hover:text-text-primary p-0.5 cursor-pointer"
                title="Fullscreen"
                onClick={(e) => { e.stopPropagation(); setFullscreen(true); }}
              >
                <Maximize2 className="w-3 h-3" />
              </span>
              <span
                className="text-text-tertiary hover:text-text-primary p-0.5 cursor-pointer"
                title="Clear events"
                onClick={(e) => { e.stopPropagation(); setEvents([]); }}
              >
                <Eraser className="w-3 h-3" />
              </span>
            </>
          )}
        </span>
      </button>

      {/* Subscription config — always visible when toggled, independent of feed open/close */}
      {configOpen && (
        <div className="px-4 py-2 border-t border-surface-border/50 bg-surface-sunken/30">
          <div className="flex flex-wrap items-center gap-1.5 mb-1.5">
            <span className="text-[9px] text-text-quaternary uppercase tracking-wider shrink-0">Subscribed:</span>
            <span className="text-[9px] font-mono text-accent px-1.5 py-0.5 bg-accent/10 rounded">{pagePattern.replace('lt.events.', '')}</span>
            {userPatterns.map((p) => (
              <span key={p} className="inline-flex items-center gap-1 text-[9px] font-mono text-text-secondary px-1.5 py-0.5 bg-surface-sunken rounded">
                {p.replace('lt.events.', '')}
                <button onClick={() => removePattern(p)} className="text-text-quaternary hover:text-status-error"><X className="w-2 h-2" /></button>
              </span>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={newPattern}
              onChange={(e) => setNewPattern(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && newPattern.trim()) { addPattern(newPattern.trim()); setNewPattern(''); } }}
              placeholder="task.> or file.stored"
              className="input text-[10px] font-mono flex-1 py-1"
            />
            <button
              onClick={() => { if (newPattern.trim()) { addPattern(newPattern.trim()); setNewPattern(''); } }}
              className="text-[10px] text-accent hover:text-accent-hover flex items-center gap-0.5"
            >
              <Plus className="w-2.5 h-2.5" /> Add
            </button>
          </div>
        </div>
      )}

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

      <FullscreenOverlay open={fullscreen} onClose={() => setFullscreen(false)} sourceRef={scrollRef}>
        <div className="sticky top-0 float-right z-10">
          <button
            onClick={() => setFullscreen(false)}
            className="p-2 rounded text-text-tertiary hover:text-text-primary hover:bg-surface-raised transition-colors duration-150 bg-surface-sunken/80 backdrop-blur-sm"
            title="Close (Esc)"
          >
            <Minimize2 className="w-5 h-5" />
          </button>
        </div>
        {events.length === 0 ? (
          <p className="text-sm text-text-tertiary py-8">No events captured</p>
        ) : (
          events.map((evt) => <EventRow key={evt.id} event={evt} forceExpanded />)
        )}
      </FullscreenOverlay>
    </div>
  );
}
