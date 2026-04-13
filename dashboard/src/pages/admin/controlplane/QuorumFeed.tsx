import { useState, useCallback, useRef, useEffect } from 'react';
import { Radio, Settings, Eraser, Code } from 'lucide-react';
import { JsonViewer } from '../../../components/common/data/JsonViewer';
import { Collapsible } from '../../../components/common/layout/Collapsible';
import { useEventSubscription } from '../../../hooks/useEventContext';
import {
  EVENT_TYPE_COLORS,
  QUORUM_CHANNELS,
  MAX_EVENTS,
  formatThrottleHuman,
  type QuorumEvent,
} from './helpers';

let eventCounter = 0;

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

// ── Config panel ────────────────────────────────────────────────────────────

interface ConfigPanelProps {
  channels: Set<string>;
  onToggle: (key: string) => void;
  customFilter: string;
  onCustomFilterChange: (v: string) => void;
}

function ConfigPanel({ channels, onToggle, customFilter, onCustomFilterChange }: ConfigPanelProps) {
  return (
    <div className="space-y-3 pb-3 border-b border-surface-border mb-3">
      <div className="flex items-center gap-2 mb-1">
        <p className="text-[9px] font-semibold uppercase tracking-widest text-text-tertiary">
          Channels
        </p>
        <p className="text-[9px] text-text-tertiary">
          Unchecked channels are dropped before buffering
        </p>
      </div>
      <div className="grid grid-cols-2 gap-1">
        {QUORUM_CHANNELS.map((ch) => (
          <label key={ch.key} className="flex items-center gap-2 cursor-pointer py-0.5">
            <input
              type="checkbox"
              checked={channels.has(ch.key)}
              onChange={() => onToggle(ch.key)}
              className="w-3 h-3 rounded border-border accent-accent"
            />
            <span className="text-[10px] text-text-secondary" title={ch.description}>
              {ch.label}
            </span>
          </label>
        ))}
      </div>
      <div>
        <p className="text-[9px] font-semibold uppercase tracking-widest text-text-tertiary mb-1">
          Text Filter
        </p>
        <input
          type="text"
          value={customFilter}
          onChange={(e) => onCustomFilterChange(e.target.value)}
          placeholder="pong"
          className="input text-[10px] font-mono py-1 px-2 w-full"
        />
        <p className="text-[9px] text-text-tertiary mt-1">
          Filter by event type, e.g. <span className="font-mono">pong</span>, <span className="font-mono">throttle</span>, or any text in the event data.
        </p>
      </div>
    </div>
  );
}

// ── Feed panel ──────────────────────────────────────────────────────────────

interface QuorumFeedProps {
  bridgeActive: boolean;
}

export function QuorumFeed({ bridgeActive }: QuorumFeedProps) {
  const [showConfig, setShowConfig] = useState(false);
  const [showRaw, setShowRaw] = useState(false);
  const [events, setEvents] = useState<QuorumEvent[]>([]);
  const [channels, setChannels] = useState<Set<string>>(
    () => new Set(QUORUM_CHANNELS.map((c) => c.key)),
  );
  const [customFilter, setCustomFilter] = useState('');

  // Keep a ref to channels so the NATS callback reads the latest without re-subscribing
  const channelsRef = useRef(channels);
  useEffect(() => { channelsRef.current = channels; }, [channels]);
  const customFilterRef = useRef(customFilter);
  useEffect(() => { customFilterRef.current = customFilter; }, [customFilter]);

  const toggleChannel = (key: string) => {
    setChannels((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // Subscribe to NATS and filter on intake (before buffer)
  useEventSubscription('lt.events.mesh.>', useCallback((raw: any) => {
    const type = raw.type?.replace('mesh.', '') || 'unknown';

    // Channel filter: drop events for unchecked channels at intake
    if (!channelsRef.current.has(type)) return;

    // Text filter: if set, match against type or stringified data
    const cf = customFilterRef.current;
    if (cf) {
      const haystack = `${type} ${JSON.stringify(raw.data || raw)}`.toLowerCase();
      if (!haystack.includes(cf.toLowerCase())) return;
    }

    setEvents((prev) => {
      const next = [{
        id: ++eventCounter,
        type,
        timestamp: raw.timestamp || new Date().toISOString(),
        data: raw.data || raw,
      }, ...prev];
      return next.slice(0, MAX_EVENTS);
    });
  }, []));

  const handleClear = () => setEvents([]);

  return (
    <div className="border-l border-surface-border pl-6 pt-4 min-h-[300px] sticky top-14 self-start max-h-[calc(100vh-8rem)] flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-2 mb-3">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary">
          Event Stream
        </p>
        <Radio className={`w-3 h-3 ${bridgeActive ? 'text-status-success animate-pulse' : 'text-text-tertiary'}`} />
        <span className="text-[9px] text-text-tertiary">
          {bridgeActive ? 'Live' : '...'}
        </span>

        <span className="ml-auto flex items-center gap-1">
          <button
            onClick={() => { setShowConfig((v) => !v); setShowRaw(false); }}
            className={`p-1 rounded transition-colors ${showConfig ? 'text-accent bg-accent/10' : 'text-text-tertiary hover:text-text-primary'}`}
            title="Configure channels"
          >
            <Settings className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => { setShowRaw((v) => !v); setShowConfig(false); }}
            className={`p-1 rounded transition-colors ${showRaw ? 'text-accent bg-accent/10' : 'text-text-tertiary hover:text-text-primary'}`}
            title="View raw JSON"
          >
            <Code className="w-3.5 h-3.5" />
          </button>
          {events.length > 0 && (
            <button
              onClick={handleClear}
              className="p-1 rounded text-text-tertiary hover:text-text-primary transition-colors"
              title="Clear events"
            >
              <Eraser className="w-3.5 h-3.5" />
            </button>
          )}
        </span>
      </div>

      {/* Config panel (animated) */}
      <Collapsible open={showConfig}>
        <ConfigPanel
          channels={channels}
          onToggle={toggleChannel}
          customFilter={customFilter}
          onCustomFilterChange={setCustomFilter}
        />
      </Collapsible>

      {/* Raw JSON view */}
      <Collapsible open={showRaw}>
        <div className="pb-3 border-b border-surface-border mb-3">
          <pre className="text-[9px] font-mono text-text-tertiary bg-surface-sunken rounded-lg p-3 max-h-[50vh] overflow-auto whitespace-pre-wrap">
            {JSON.stringify(events.slice(0, 50), null, 2)}
          </pre>
        </div>
      </Collapsible>

      {/* Event count */}
      {events.length > 0 && (
        <p className="text-[9px] text-text-tertiary mb-2">
          {events.length} events
        </p>
      )}

      {/* Event list */}
      <div className="flex-1 overflow-y-auto">
        {events.length === 0 ? (
          <p className="text-xs text-text-tertiary py-6 text-center">
            {bridgeActive ? 'Waiting for events...' : 'Subscribing...'}
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
