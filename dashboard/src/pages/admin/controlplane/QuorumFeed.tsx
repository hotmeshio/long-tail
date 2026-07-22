import { useState, useCallback, useRef, useEffect } from 'react';
import { Radio, Settings, Eraser, Code } from 'lucide-react';
import { JsonViewer } from '../../../components/common/data/JsonViewer';
import { Collapsible } from '../../../components/common/layout/Collapsible';
import { useEventSubscription } from '../../../hooks/useEventContext';
import {
  EVENT_TYPE_COLORS,
  EVENT_TYPE_LABELS,
  QUORUM_CHANNELS,
  MAX_EVENTS,
  formatThrottleHuman,
  type QuorumEvent,
} from './helpers';

let eventCounter = 0;

// ── Human-readable event summaries ─────────────────────────────────────────

function humanizeEvent(event: QuorumEvent): string {
  const d = event.data || {};
  const topic = d.topic ? String(d.topic) : '';
  const guid = d.guid ? String(d.guid).slice(0, 8) : '';

  switch (event.type) {
    case 'pong':
      return topic
        ? `Worker ${guid}... on "${topic}" responded`
        : `Engine ${guid}... responded`;
    case 'ping':
      return 'Roll call broadcast';
    case 'throttle': {
      const ms = d.throttle as number;
      const target = topic ? `queue "${topic}"` : guid ? `node ${guid}...` : 'all nodes';
      return `${formatThrottleHuman(ms)} applied to ${target}`;
    }
    case 'job':
      return `Job ${guid ? guid + '...' : ''} ${d.status || 'updated'}`;
    case 'work':
      return `Dispatched to "${topic || 'worker'}" ${guid ? '(' + guid + '...)' : ''}`;
    case 'activate':
      return `Worker "${topic || 'unknown'}" activated`;
    case 'cron':
      return `Cron triggered ${topic ? '"' + topic + '"' : ''}`;
    default:
      return topic || guid || event.type;
  }
}

// ── Aggregate display items ───────────────────────────────────────────────

interface DisplayItem {
  kind: 'single';
  event: QuorumEvent;
}

interface DisplayGroup {
  kind: 'group';
  type: string;
  count: number;
  firstTimestamp: string;
  lastTimestamp: string;
  events: QuorumEvent[];
}

type FeedItem = DisplayItem | DisplayGroup;

/** Collapse consecutive pong events into a summary row. */
function collapseEvents(events: QuorumEvent[]): FeedItem[] {
  const items: FeedItem[] = [];
  let i = 0;
  while (i < events.length) {
    const evt = events[i];
    // Group consecutive pong events
    if (evt.type === 'pong') {
      let j = i + 1;
      while (j < events.length && events[j].type === 'pong') j++;
      const batch = events.slice(i, j);
      if (batch.length >= 3) {
        items.push({
          kind: 'group',
          type: 'pong',
          count: batch.length,
          firstTimestamp: batch[batch.length - 1].timestamp,
          lastTimestamp: batch[0].timestamp,
          events: batch,
        });
      } else {
        for (const e of batch) items.push({ kind: 'single', event: e });
      }
      i = j;
    } else {
      items.push({ kind: 'single', event: evt });
      i++;
    }
  }
  return items;
}

// ── Event row ───────────────────────────────────────────────────────────────

function QuorumEventRow({ event }: { event: QuorumEvent }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border-b border-surface-border/50 last:border-b-0">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 py-1.5 w-full text-left hover:bg-surface-hover/50 transition-colors"
      >
        <span className="text-2xs font-mono text-text-tertiary whitespace-nowrap tabular-nums shrink-0">
          {new Date(event.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
        </span>
        <span className={`text-2xs font-medium px-1 py-0.5 rounded ${EVENT_TYPE_COLORS[event.type] || 'text-text-tertiary'} bg-surface-sunken whitespace-nowrap shrink-0`}>
          {EVENT_TYPE_LABELS[event.type] || event.type}
        </span>
        <span className="text-2xs text-text-secondary flex-1 min-w-0 truncate">
          {humanizeEvent(event)}
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

/** Collapsed group row for consecutive pong events. */
function QuorumGroupRow({ group }: { group: DisplayGroup }) {
  const [expanded, setExpanded] = useState(false);
  const engines = group.events.filter((e) => !e.data?.topic).length;
  const workers = group.count - engines;

  return (
    <div className="border-b border-surface-border/50 last:border-b-0">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 py-1.5 w-full text-left hover:bg-surface-hover/50 transition-colors"
      >
        <span className="text-2xs font-mono text-text-tertiary whitespace-nowrap tabular-nums shrink-0">
          {new Date(group.lastTimestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
        </span>
        <span className={`text-2xs font-medium px-1 py-0.5 rounded ${EVENT_TYPE_COLORS.pong} bg-surface-sunken whitespace-nowrap shrink-0`}>
          roll call
        </span>
        <span className="text-2xs text-text-secondary flex-1 min-w-0 truncate">
          {group.count} nodes responded
          {engines > 0 && workers > 0
            ? ` (${engines} engine${engines !== 1 ? 's' : ''}, ${workers} worker${workers !== 1 ? 's' : ''})`
            : engines > 0
              ? ` (${engines} engine${engines !== 1 ? 's' : ''})`
              : ` (${workers} worker${workers !== 1 ? 's' : ''})`}
        </span>
        <svg
          className={`w-2.5 h-2.5 text-text-tertiary shrink-0 transition-transform duration-150 ${expanded ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      <Collapsible open={expanded}>
        <div className="ml-4">
          {group.events.map((evt) => (
            <QuorumEventRow key={evt.id} event={evt} />
          ))}
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
        <p className="text-2xs font-semibold uppercase tracking-widest text-text-tertiary">
          Channels
        </p>
        <p className="text-2xs text-text-tertiary">
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
            <span className="text-2xs text-text-secondary" title={ch.description}>
              {ch.label}
            </span>
          </label>
        ))}
      </div>
      <div>
        <p className="text-2xs font-semibold uppercase tracking-widest text-text-tertiary mb-1">
          Text Filter
        </p>
        <input
          type="text"
          value={customFilter}
          onChange={(e) => onCustomFilterChange(e.target.value)}
          placeholder="pong"
          className="input text-2xs font-mono py-1 px-2 w-full"
        />
        <p className="text-2xs text-text-tertiary mt-1">
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

  // Keep a ref to channels so the event callback reads the latest without re-subscribing
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
        <p className="text-2xs font-semibold uppercase tracking-widest text-text-tertiary">
          Event Stream
        </p>
        <Radio className={`w-3 h-3 ${bridgeActive ? 'text-status-success animate-pulse' : 'text-text-tertiary'}`} />
        <span className="text-2xs text-text-tertiary">
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
          <pre className="text-2xs font-mono text-text-tertiary bg-surface-sunken rounded-lg p-3 max-h-[50vh] overflow-auto whitespace-pre-wrap">
            {JSON.stringify(events.slice(0, 50), null, 2)}
          </pre>
        </div>
      </Collapsible>

      {/* Event count */}
      {events.length > 0 && (
        <p className="text-2xs text-text-tertiary mb-2">
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
          collapseEvents(events).map((item, idx) =>
            item.kind === 'group' ? (
              <QuorumGroupRow key={`grp-${idx}`} group={item} />
            ) : (
              <QuorumEventRow key={item.event.id} event={item.event} />
            ),
          )
        )}
      </div>
    </div>
  );
}
