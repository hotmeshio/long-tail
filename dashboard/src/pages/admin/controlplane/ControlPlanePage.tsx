import { useMemo, useState, useCallback, useEffect } from 'react';
import { RefreshCw, Radio } from 'lucide-react';
import { PageHeader } from '../../../components/common/layout/PageHeader';
import { StatCard } from '../../../components/common/data/StatCard';
import { DataTable, type Column } from '../../../components/common/data/DataTable';
import { JsonViewer } from '../../../components/common/data/JsonViewer';
import { SectionLabel } from '../../../components/common/layout/SectionLabel';
import { FilterBar, FilterSelect } from '../../../components/common/data/FilterBar';
import { TaskQueuePill } from '../../../components/common/display/TaskQueuePill';
import { Modal } from '../../../components/common/modal/Modal';
import { Collapsible } from '../../../components/common/layout/Collapsible';
import { useFilterParams } from '../../../hooks/useFilterParams';
import { useNatsSubscription } from '../../../hooks/useNats';
import {
  useControlPlaneApps,
  useRollCall,
  useStreamStats,
  useThrottle,
  useSubscribeMesh,
  type QuorumProfile,
} from '../../../api/controlplane';

// ── Constants ───────────────────────────────────────────────────────────────

const DURATIONS = [
  { label: '15m', value: '15m' },
  { label: '30m', value: '30m' },
  { label: '1h', value: '1h' },
  { label: '1d', value: '1d' },
  { label: '7d', value: '7d' },
] as const;

type Duration = (typeof DURATIONS)[number]['value'];

// ── Helpers ─────────────────────────────────────────────────────────────────

function isWorker(p: QuorumProfile): boolean {
  return !!p.worker_topic;
}

function isThrottled(p: QuorumProfile): boolean {
  return typeof p.throttle === 'number' && p.throttle !== 0;
}

function formatThrottleHuman(ms?: number): string {
  if (ms === undefined || ms === 0) return 'Normal';
  if (ms === -1) return 'Paused';
  if (ms >= 86_400_000) return `${(ms / 86_400_000).toFixed(0)}d`;
  if (ms >= 3_600_000) return `${(ms / 3_600_000).toFixed(1)}h`;
  if (ms >= 60_000) return `${(ms / 60_000).toFixed(1)}m`;
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${ms}ms`;
}

function formatMemory(total?: string, free?: string): string {
  if (!total || !free) return '—';
  const t = parseFloat(total);
  const f = parseFloat(free);
  if (isNaN(t) || isNaN(f)) return '—';
  return `${(t - f).toFixed(1)} / ${t.toFixed(1)} GB`;
}

/** Strip the HotMesh prefix from stream names for display */
function stripStreamPrefix(name: string): string {
  return name.replace(/^hmsh:[^:]+:x:/, '') || '(engine)';
}

// ── Quorum event types ──────────────────────────────────────────────────────

interface QuorumEvent {
  id: number;
  type: string;
  timestamp: string;
  data: Record<string, unknown>;
}

const EVENT_TYPE_COLORS: Record<string, string> = {
  pong: 'text-status-success',
  ping: 'text-accent',
  throttle: 'text-status-warning',
  job: 'text-purple-400',
  work: 'text-text-secondary',
  activate: 'text-status-error',
  cron: 'text-text-tertiary',
  user: 'text-text-secondary',
};

const MAX_EVENTS = 200;
let eventCounter = 0;

// ── Throttle modal ──────────────────────────────────────────────────────────

function ThrottleModal({
  open,
  onClose,
  targets,
  onApply,
  isPending,
}: {
  open: boolean;
  onClose: () => void;
  targets: string[];
  onApply: (ms: number) => void;
  isPending: boolean;
}) {
  const [seconds, setSeconds] = useState('0');

  const presets = [
    { label: 'Resume', ms: 0 },
    { label: '0.5s', ms: 500 },
    { label: '1s', ms: 1000 },
    { label: '5s', ms: 5000 },
    { label: '30s', ms: 30000 },
    { label: 'Pause', ms: -1 },
  ];

  return (
    <Modal open={open} onClose={onClose} title="Adjust Throttle">
      <div className="space-y-4">
        <div>
          <p className="text-[9px] font-semibold uppercase tracking-widest text-text-tertiary mb-2">Targets</p>
          <div className="flex flex-wrap gap-1.5">
            {targets.map((t) => (
              <TaskQueuePill key={t} queue={t} />
            ))}
          </div>
        </div>

        <div>
          <p className="text-[9px] font-semibold uppercase tracking-widest text-text-tertiary mb-2">Presets</p>
          <div className="flex flex-wrap gap-2">
            {presets.map((p) => (
              <button
                key={p.label}
                onClick={() => { setSeconds(p.ms === -1 ? '-1' : String(p.ms / 1000)); onApply(p.ms); }}
                disabled={isPending}
                className={`px-3 py-1.5 text-xs rounded transition-colors ${
                  p.ms === -1
                    ? 'bg-status-error/10 text-status-error hover:bg-status-error/20'
                    : p.ms === 0
                      ? 'bg-status-success/10 text-status-success hover:bg-status-success/20'
                      : 'bg-surface-sunken text-text-secondary hover:bg-surface-hover'
                } disabled:opacity-50`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="text-[9px] font-semibold uppercase tracking-widest text-text-tertiary mb-2">
            Custom (seconds between messages)
          </p>
          <div className="flex items-center gap-3">
            <input
              type="number"
              step="0.1"
              min="-1"
              value={seconds}
              onChange={(e) => setSeconds(e.target.value)}
              className="input text-xs py-1.5 px-3 w-28"
            />
            <button
              onClick={() => {
                const s = parseFloat(seconds);
                if (isNaN(s)) return;
                onApply(s === -1 ? -1 : Math.round(s * 1000));
              }}
              disabled={isPending}
              className="btn-primary text-xs py-1.5 px-4 disabled:opacity-50"
            >
              Apply
            </button>
          </div>
          <p className="text-[10px] text-text-tertiary mt-1">
            0 = resume, -1 = pause indefinitely
          </p>
        </div>
      </div>
    </Modal>
  );
}

// ── Bulk action bar ─────────────────────────────────────────────────────────

function MeshBulkActionBar({
  selectedCount,
  onClear,
  onThrottle,
  isPending,
}: {
  selectedCount: number;
  onClear: () => void;
  onThrottle: () => void;
  isPending: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 px-4 py-3 bg-accent/5 border border-accent/20 rounded-lg mb-4">
      <span className="text-xs font-medium text-accent">
        {selectedCount} selected
      </span>
      <div className="w-px h-5 bg-surface-border" />
      <button
        onClick={onThrottle}
        disabled={isPending}
        className="btn-secondary text-xs py-1.5 disabled:opacity-50"
      >
        Adjust Throttle...
      </button>
      <div className="flex-1" />
      <button
        onClick={onClear}
        className="text-xs text-text-tertiary hover:text-text-primary transition-colors"
      >
        Clear
      </button>
    </div>
  );
}

// ── Stream volume bar chart ─────────────────────────────────────────────────

function StreamVolumeChart({
  byStream,
}: {
  byStream: Array<{ stream_name: string; count: number }>;
}) {
  const [animated, setAnimated] = useState(false);

  // Reset and re-trigger animation when data changes
  useEffect(() => {
    setAnimated(false);
    const raf = requestAnimationFrame(() => setAnimated(true));
    return () => cancelAnimationFrame(raf);
  }, [byStream]);

  if (byStream.length === 0) {
    return <p className="text-xs text-text-tertiary py-4 text-center">No activity in this period</p>;
  }

  const maxCount = Math.max(...byStream.map((s) => s.count));

  return (
    <div className="space-y-1.5">
      {byStream.map((s) => {
        const pct = maxCount > 0 ? (s.count / maxCount) * 100 : 0;
        const label = stripStreamPrefix(s.stream_name);
        return (
          <div key={s.stream_name} className="flex items-center gap-3">
            <span className="text-[9px] font-mono text-text-tertiary w-36 truncate text-right shrink-0" title={s.stream_name}>
              {label}
            </span>
            <div className="flex-1 h-4 bg-surface-sunken rounded overflow-hidden">
              <div
                className="h-full bg-accent/60 rounded transition-all duration-500 ease-out"
                style={{ width: animated ? `${pct}%` : '0%' }}
              />
            </div>
            <span className="text-[10px] font-mono tabular-nums text-text-secondary w-12 text-right shrink-0">
              {s.count.toLocaleString()}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ── Quorum event row (expandable) ───────────────────────────────────────────

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

// ── Main component ──────────────────────────────────────────────────────────

export function ControlPlanePage() {
  const { data: appsData } = useControlPlaneApps();
  const apps = appsData?.apps ?? [];

  const { filters, setFilter } = useFilterParams({
    filters: { app_id: '', duration: '1h' },
  });

  const firstAppId = apps[0]?.appId ?? 'durable';
  const activeAppId = filters.app_id || firstAppId;
  const activeDuration = (filters.duration || '1h') as Duration;

  const { data: rollCallData, isLoading, refetch, isFetching } = useRollCall(activeAppId);
  const { data: streamStats } = useStreamStats(activeAppId, activeDuration);
  const throttleMutation = useThrottle();
  const subscribeMesh = useSubscribeMesh();

  // ── Selection state ─────────────────────────────────────────
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [throttleModalOpen, setThrottleModalOpen] = useState(false);
  const [throttleTargets, setThrottleTargets] = useState<string[]>([]);

  useEffect(() => { setSelectedIds(new Set()); }, [activeAppId]);

  // ── Sort profiles alphabetically ────────────────────────────
  const profiles = useMemo(() => {
    const raw = rollCallData?.profiles ?? [];
    return [...raw].sort((a, b) => {
      const ta = a.worker_topic || a.stream || '';
      const tb = b.worker_topic || b.stream || '';
      if (!a.worker_topic && b.worker_topic) return -1;
      if (a.worker_topic && !b.worker_topic) return 1;
      return ta.localeCompare(tb);
    });
  }, [rollCallData?.profiles]);

  const engineCount = profiles.filter((p) => !p.worker_topic).length;
  const workerCount = profiles.filter(isWorker).length;
  const throttledCount = profiles.filter(isThrottled).length;

  const appOptions = useMemo(() => {
    const ids = new Set(apps.map((a) => a.appId));
    if (activeAppId) ids.add(activeAppId);
    return [...ids].sort().map((id) => ({ value: id, label: id }));
  }, [apps, activeAppId]);

  // ── Selection helpers ─────────────────────────────────────────
  const rowKey = (p: QuorumProfile) => `${p.engine_id}-${p.worker_topic || 'engine'}`;

  /** Checkbox: select all rows sharing the same task queue (workers) or all engines */
  const toggleCheckbox = useCallback((profile: QuorumProfile) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      const key = rowKey(profile);
      const selecting = !prev.has(key);

      const groupMembers = profiles.filter((p) => {
        if (isWorker(profile)) {
          return isWorker(p) && p.worker_topic === profile.worker_topic;
        }
        return !isWorker(p);
      });

      for (const m of groupMembers) {
        const mk = rowKey(m);
        if (selecting) next.add(mk);
        else next.delete(mk);
      }
      return next;
    });
  }, [profiles]);

  const toggleAll = useCallback(() => {
    if (selectedIds.size === profiles.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(profiles.map(rowKey)));
    }
  }, [profiles, selectedIds.size]);

  /** Get unique topics for the selected set */
  const selectedTopics = useMemo(() => {
    const targets = new Set<string>();
    for (const p of profiles) {
      if (selectedIds.has(rowKey(p))) {
        targets.add(p.worker_topic || p.stream || '');
      }
    }
    return [...targets].filter(Boolean).sort();
  }, [profiles, selectedIds]);

  // ── Throttle handlers ─────────────────────────────────────────
  const handleBulkThrottle = (ms: number) => {
    for (const topic of (throttleTargets.length > 0 ? throttleTargets : selectedTopics)) {
      throttleMutation.mutate({ appId: activeAppId, throttle: ms, topic });
    }
    setThrottleModalOpen(false);
    setThrottleTargets([]);
  };

  /** Row click: select ONLY this row, open throttle modal */
  const handleRowClick = (profile: QuorumProfile) => {
    const topic = profile.worker_topic || profile.stream || '';
    if (topic) {
      setThrottleTargets([topic]);
      setThrottleModalOpen(true);
    }
  };

  /** Bulk action bar → throttle */
  const handleBulkThrottleOpen = () => {
    setThrottleTargets(selectedTopics);
    setThrottleModalOpen(true);
  };

  // ── Quorum event feed ─────────────────────────────────────────
  const [events, setEvents] = useState<QuorumEvent[]>([]);
  const [bridgeActive, setBridgeActive] = useState(false);

  const handleStartBridge = useCallback(() => {
    subscribeMesh.mutate({ appId: activeAppId }, {
      onSuccess: () => setBridgeActive(true),
    });
  }, [activeAppId, subscribeMesh]);

  useNatsSubscription('lt.events.mesh.>', useCallback((event: any) => {
    setEvents((prev) => {
      const next = [{
        id: ++eventCounter,
        type: event.type?.replace('mesh.', '') || 'unknown',
        timestamp: event.timestamp || new Date().toISOString(),
        data: event.data || event,
      }, ...prev];
      return next.slice(0, MAX_EVENTS);
    });
  }, []));

  useEffect(() => {
    if (!bridgeActive && activeAppId) {
      handleStartBridge();
    }
  }, [activeAppId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Column definitions ────────────────────────────────────────

  const columns: Column<QuorumProfile>[] = [
    {
      key: 'select',
      label: (
        <input
          type="checkbox"
          checked={profiles.length > 0 && selectedIds.size === profiles.length}
          onChange={toggleAll}
          className="rounded"
        />
      ) as any,
      render: (row) => (
        <input
          type="checkbox"
          checked={selectedIds.has(rowKey(row))}
          onChange={(e) => { e.stopPropagation(); toggleCheckbox(row); }}
          onClick={(e) => e.stopPropagation()}
          className="rounded"
        />
      ),
      className: 'w-10',
    },
    {
      key: 'type',
      label: 'Type',
      render: (row) => (
        <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${
          isWorker(row)
            ? 'bg-accent/10 text-accent'
            : 'bg-purple-500/10 text-purple-400'
        }`}>
          {isWorker(row) ? 'Worker' : 'Engine'}
        </span>
      ),
      className: 'w-24',
    },
    {
      key: 'worker_topic',
      label: 'Task Queue',
      render: (row) => {
        const topic = row.worker_topic || row.stream;
        return topic ? <TaskQueuePill queue={topic} /> : <span className="text-xs text-text-tertiary">—</span>;
      },
    },
    {
      key: 'engine_id',
      label: 'ID',
      render: (row) => (
        <span className="text-xs font-mono text-text-tertiary" title={row.engine_id}>
          {row.engine_id.slice(0, 12)}…
        </span>
      ),
      className: 'w-32',
    },
    {
      key: 'throttle',
      label: 'Throttle',
      render: (row) => {
        const t = row.throttle;
        if (t === -1) return <span className="text-xs text-status-error font-medium">Paused</span>;
        if (t && t > 0) return <span className="text-xs text-status-warning font-medium">{formatThrottleHuman(t)}</span>;
        return <span className="text-xs text-status-success">Normal</span>;
      },
      className: 'w-24',
    },
    {
      key: 'memory',
      label: 'Memory',
      render: (row) => (
        <span className="text-xs font-mono text-text-tertiary">
          {formatMemory(row.system?.TotalMemoryGB, row.system?.FreeMemoryGB)}
        </span>
      ),
      className: 'w-36',
    },
  ];

  return (
    <div>
      <PageHeader title="Control Plane" />

      {/* Filters + duration tabs — all inside FilterBar for sticky scrolling */}
      <FilterBar
        actions={
          <div className="flex items-center gap-1">
            {DURATIONS.map((d) => (
              <button
                key={d.value}
                onClick={() => setFilter('duration', d.value)}
                className={`px-3 py-1 text-xs rounded-full transition-colors ${
                  activeDuration === d.value
                    ? 'bg-accent text-text-inverse'
                    : 'text-text-tertiary hover:text-text-primary hover:bg-surface-hover'
                }`}
              >
                {d.label}
              </button>
            ))}
          </div>
        }
      >
        <FilterSelect
          label="Application"
          value={filters.app_id}
          onChange={(v) => setFilter('app_id', v)}
          options={appOptions}
        />
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-text-tertiary hover:text-text-primary transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? 'animate-spin' : ''}`} />
          Roll Call
        </button>
      </FilterBar>

      {/* Summary cards */}
      <div className="grid grid-cols-4 gap-4 mb-8">
        <StatCard label="Engines" value={engineCount} />
        <StatCard label="Workers" value={workerCount} />
        <StatCard
          label="Pending"
          value={streamStats?.pending ?? 0}
          colorClass={streamStats?.pending ? 'text-status-warning' : 'text-text-primary'}
        />
        <StatCard
          label={`Processed (${activeDuration})`}
          value={(streamStats?.processed ?? 0).toLocaleString()}
        />
      </div>

      {/* Stream volume chart */}
      <SectionLabel className="mb-3">Stream Volume ({activeDuration})</SectionLabel>
      <div className="mb-8">
        <StreamVolumeChart
          byStream={streamStats?.byStream ?? []}
        />
      </div>

      {/* Main content: table (left) + quorum feed (right) */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-6">
        {/* Left — mesh nodes table */}
        <div>
          <SectionLabel className="mb-4">
            Mesh Nodes
            {throttledCount > 0 && (
              <span className="ml-2 text-status-warning font-normal">
                ({throttledCount} throttled)
              </span>
            )}
          </SectionLabel>

          {selectedIds.size > 0 && (
            <MeshBulkActionBar
              selectedCount={selectedIds.size}
              onClear={() => setSelectedIds(new Set())}
              onThrottle={handleBulkThrottleOpen}
              isPending={throttleMutation.isPending}
            />
          )}

          <DataTable
            columns={columns}
            data={profiles}
            keyFn={rowKey}
            onRowClick={handleRowClick}
            isLoading={isLoading}
            emptyMessage={isLoading ? 'Discovering mesh nodes...' : 'No nodes found. Click "Roll Call" to discover.'}
          />
        </div>

        {/* Right — quorum event feed */}
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
                onClick={() => setEvents([])}
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
      </div>

      <ThrottleModal
        open={throttleModalOpen}
        onClose={() => { setThrottleModalOpen(false); setThrottleTargets([]); }}
        targets={throttleTargets.length > 0 ? throttleTargets : selectedTopics}
        onApply={handleBulkThrottle}
        isPending={throttleMutation.isPending}
      />
    </div>
  );
}
