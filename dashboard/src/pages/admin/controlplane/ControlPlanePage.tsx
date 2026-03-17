import { useMemo, useState, useCallback, useEffect } from 'react';
import { RefreshCw } from 'lucide-react';
import { PageHeader } from '../../../components/common/layout/PageHeader';
import { StatCard } from '../../../components/common/data/StatCard';
import { DataTable, type Column } from '../../../components/common/data/DataTable';
import { SectionLabel } from '../../../components/common/layout/SectionLabel';
import { FilterBar, FilterSelect } from '../../../components/common/data/FilterBar';
import { TaskQueuePill } from '../../../components/common/display/TaskQueuePill';
import { useFilterParams } from '../../../hooks/useFilterParams';
import {
  useControlPlaneApps,
  useRollCall,
  useStreamStats,
  useThrottle,
  useSubscribeMesh,
  type QuorumProfile,
} from '../../../api/controlplane';
import {
  DURATIONS,
  isWorker,
  isThrottled,
  formatThrottleHuman,
  formatMemory,
  rowKey,
  NODE_FILTER_OPTIONS,
  type Duration,
  type NodeFilter,
  type ThrottleTarget,
} from './helpers';
import { ThrottleModal } from './ThrottleModal';
import { MeshBulkActionBar } from './MeshBulkActionBar';
import { StreamVolumeChart } from './StreamVolumeChart';
import { QuorumFeed } from './QuorumFeed';

export function ControlPlanePage() {
  const { data: appsData } = useControlPlaneApps();
  const apps = appsData?.apps ?? [];

  const { filters, setFilter } = useFilterParams({
    filters: { app_id: '', duration: '1h', nodes: '', queue: '' },
  });

  const firstAppId = apps[0]?.appId ?? 'durable';
  const activeAppId = filters.app_id || firstAppId;
  const activeDuration = (filters.duration || '1h') as Duration;
  const activeNodeFilter = (filters.nodes || 'all') as NodeFilter;

  const throttleMutation = useThrottle();
  const subscribeMesh = useSubscribeMesh();

  // ── Auto-refresh: 15s when events flowing, 60s otherwise ───
  const [eventsActive, setEventsActive] = useState(false);
  const refreshInterval = eventsActive ? 15_000 : 60_000;

  const { data: rollCallData, isLoading, error: rollCallError, refetch, isFetching } = useRollCall(activeAppId, refreshInterval);
  const { data: streamStats } = useStreamStats(activeAppId, activeDuration, undefined, refreshInterval);

  // ── Selection state ─────────────────────────────────────────
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [throttleModalOpen, setThrottleModalOpen] = useState(false);
  const [throttleTargets, setThrottleTargets] = useState<ThrottleTarget[]>([]);

  useEffect(() => { setSelectedIds(new Set()); }, [activeAppId]);

  // ── All profiles (sorted) ───────────────────────────────────
  const allProfiles = useMemo(() => {
    const raw = rollCallData?.profiles ?? [];
    return [...raw].sort((a, b) => {
      const ta = a.worker_topic || a.stream || '';
      const tb = b.worker_topic || b.stream || '';
      if (!a.worker_topic && b.worker_topic) return -1;
      if (a.worker_topic && !b.worker_topic) return 1;
      return ta.localeCompare(tb);
    });
  }, [rollCallData?.profiles]);

  // ── Counts from all profiles ────────────────────────────────
  const engineCount = allProfiles.filter((p) => !p.worker_topic).length;
  const workerCount = allProfiles.filter(isWorker).length;
  const throttledCount = allProfiles.filter(isThrottled).length;

  // ── Filtered profiles for table ─────────────────────────────
  const activeQueue = filters.queue || '';

  const profiles = useMemo(() => {
    let result = allProfiles;
    if (activeNodeFilter === 'workers') result = result.filter(isWorker);
    else if (activeNodeFilter === 'engines') result = result.filter((p) => !isWorker(p));
    if (activeQueue) result = result.filter((p) => p.worker_topic === activeQueue);
    return result;
  }, [allProfiles, activeNodeFilter, activeQueue]);

  const appOptions = useMemo(() => {
    const ids = new Set(apps.map((a) => a.appId));
    if (activeAppId) ids.add(activeAppId);
    return [...ids].sort().map((id) => ({ value: id, label: id }));
  }, [apps, activeAppId]);

  const queueOptions = useMemo(() => {
    const queues = new Set<string>();
    for (const p of allProfiles) {
      if (p.worker_topic) queues.add(p.worker_topic);
    }
    return [...queues].sort().map((q) => ({ value: q, label: q }));
  }, [allProfiles]);

  // ── Selection helpers (per-row, no auto-grouping) ────────────
  const toggleCheckbox = useCallback((profile: QuorumProfile) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      const key = rowKey(profile);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    if (selectedIds.size === profiles.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(profiles.map(rowKey)));
    }
  }, [profiles, selectedIds.size]);

  /**
   * Build throttle targets from checkbox selection.
   *
   * Smart grouping:
   * - All nodes selected → no topic/guid (entire mesh)
   * - All engines selected → topic = engine stream (all engines)
   * - All workers on a queue selected → topic = queue (all workers on queue)
   * - Subset of a group → individual guid targets
   */
  const selectedThrottleTargets = useMemo((): ThrottleTarget[] => {
    const selected = profiles.filter((p) => selectedIds.has(rowKey(p)));
    if (selected.length === 0) return [];

    // All nodes → entire mesh
    if (selected.length === allProfiles.length) {
      return [{ label: 'Entire Mesh' }];
    }

    const engines = selected.filter((p) => !isWorker(p));
    const workers = selected.filter(isWorker);
    const allEngines = allProfiles.filter((p) => !isWorker(p));
    const targets: ThrottleTarget[] = [];

    // Engines
    if (engines.length > 0) {
      if (engines.length === allEngines.length) {
        // All engines selected → target by topic (engine stream)
        targets.push({ label: 'All Engines', topic: engines[0].stream || '' });
      } else {
        // Individual engines → target by guid
        for (const e of engines) {
          targets.push({ label: `Engine ${e.engine_id.slice(0, 10)}...`, guid: e.engine_id });
        }
      }
    }

    // Workers — group by queue, then decide per-queue
    const queues = new Map<string, QuorumProfile[]>();
    for (const w of workers) {
      const q = w.worker_topic!;
      if (!queues.has(q)) queues.set(q, []);
      queues.get(q)!.push(w);
    }
    for (const [queue, members] of queues) {
      const allOnQueue = allProfiles.filter((p) => p.worker_topic === queue);
      if (members.length === allOnQueue.length) {
        // All workers on this queue selected → target by topic
        targets.push({ label: queue, topic: queue });
      } else {
        // Individual workers → target by guid
        for (const w of members) {
          targets.push({ label: `${queue} ${w.engine_id.slice(0, 10)}...`, guid: w.engine_id });
        }
      }
    }

    return targets;
  }, [profiles, allProfiles, selectedIds]);

  // ── Throttle handlers ─────────────────────────────────────────
  const handleBulkThrottle = (ms: number) => {
    const targets = throttleTargets.length > 0 ? throttleTargets : selectedThrottleTargets;
    for (const t of targets) {
      throttleMutation.mutate({
        appId: activeAppId,
        throttle: ms,
        ...(t.topic ? { topic: t.topic } : {}),
        ...(t.guid ? { guid: t.guid } : {}),
      });
    }
    setThrottleModalOpen(false);
    setThrottleTargets([]);
  };

  const handleRowClick = (profile: QuorumProfile) => {
    // Single node click → target that specific instance by guid
    const label = isWorker(profile)
      ? `${profile.worker_topic} ${profile.engine_id.slice(0, 10)}...`
      : `Engine ${profile.engine_id.slice(0, 10)}...`;
    setThrottleTargets([{ label, guid: profile.engine_id }]);
    setThrottleModalOpen(true);
  };

  const handleBulkThrottleOpen = () => {
    setThrottleTargets(selectedThrottleTargets);
    setThrottleModalOpen(true);
  };

  // ── Quorum bridge ────────────────────────────────────────────
  const [bridgeActive, setBridgeActive] = useState(false);

  const handleStartBridge = useCallback(() => {
    subscribeMesh.mutate({ appId: activeAppId }, {
      onSuccess: () => setBridgeActive(true),
    });
  }, [activeAppId, subscribeMesh]);

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
        <span className={`text-xs ${isWorker(row) ? 'text-text-secondary' : 'text-blue-500'}`}>
          {isWorker(row) ? 'Worker' : 'Engine'}
        </span>
      ),
      className: 'w-20',
    },
    {
      key: 'worker_topic',
      label: 'Task Queue',
      render: (row) => {
        if (!isWorker(row)) return <span className="text-xs text-text-tertiary">—</span>;
        return <TaskQueuePill queue={row.worker_topic!} />;
      },
      className: 'w-64',
    },
    {
      key: 'engine_id',
      label: 'Engine/Worker ID',
      render: (row) => (
        <span className="text-xs font-mono text-text-tertiary">
          {row.engine_id}
        </span>
      ),
      className: 'w-48',
    },
    {
      key: 'throttle',
      label: 'Throttle',
      render: (row) => {
        const t = row.throttle;
        if (t === -1) return <span className="text-xs text-status-error font-medium">Paused</span>;
        if (t && t > 0) return <span className="text-xs text-status-warning font-medium">{formatThrottleHuman(t)}</span>;
        return <span className="text-xs text-text-tertiary">0</span>;
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
      <PageHeader title="Task Queues" />

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
        <FilterSelect
          label="Nodes"
          value={filters.nodes}
          onChange={(v) => setFilter('nodes', v)}
          options={NODE_FILTER_OPTIONS as any}
        />
        <FilterSelect
          label="Queue"
          value={filters.queue}
          onChange={(v) => setFilter('queue', v)}
          options={queueOptions}
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

      {/* Error banner */}
      {rollCallError && (
        <div className="mb-6 px-4 py-3 rounded bg-status-error/10 border border-status-error/20">
          <p className="text-xs text-status-error font-medium">
            {rollCallError.message === 'Session expired'
              ? 'Session expired — please log in again.'
              : `Failed to load mesh data: ${rollCallError.message}`}
          </p>
        </div>
      )}

      {/* Summary cards */}
      {(() => {
        const byStream = streamStats?.byStream ?? [];
        const engineProcessed = byStream.filter((s) => s.stream_type === 'engine').reduce((sum, s) => sum + s.count, 0);
        const workerProcessed = byStream.filter((s) => s.stream_type === 'worker').reduce((sum, s) => sum + s.count, 0);
        return (
          <div className="grid grid-cols-5 gap-4 mb-8">
            <StatCard label="Engines" value={engineCount} />
            <StatCard label="Workers" value={workerCount} />
            <StatCard
              label="Pending"
              value={streamStats?.pending ?? 0}
              colorClass={streamStats?.pending ? 'text-status-warning' : 'text-text-primary'}
            />
            <StatCard
              label={`Engine Msgs (${activeDuration})`}
              value={engineProcessed.toLocaleString()}
              colorClass="text-blue-500"
            />
            <StatCard
              label={`Worker Msgs (${activeDuration})`}
              value={workerProcessed.toLocaleString()}
            />
          </div>
        );
      })()}

      {/* Stream volume chart */}
      <SectionLabel className="mb-3">Stream Volume ({activeDuration})</SectionLabel>
      <div className="mb-8">
        <StreamVolumeChart
          byStream={streamStats?.byStream ?? []}
          onNodeFilter={(f) => setFilter('nodes', f)}
          onQueueFilter={(q) => { setFilter('nodes', 'workers'); setFilter('queue', q); }}
        />
      </div>

      {/* Main content: table (left) + quorum feed (right) */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-6">
        <div>
          <SectionLabel className="mb-4">
            {activeNodeFilter === 'engines' ? 'Engine Nodes' : activeNodeFilter === 'workers' ? 'Worker Nodes' : 'Mesh Nodes'}
            <span className="ml-2 text-text-tertiary font-normal text-xs">
              {profiles.length}{activeNodeFilter !== 'all' ? ` of ${allProfiles.length}` : ''}
            </span>
            {throttledCount > 0 && (
              <span className="ml-2 text-status-warning font-normal">({throttledCount} throttled)</span>
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

        <QuorumFeed bridgeActive={bridgeActive} onEventsActive={() => setEventsActive(true)} />
      </div>

      <ThrottleModal
        open={throttleModalOpen}
        onClose={() => { setThrottleModalOpen(false); setThrottleTargets([]); }}
        targets={throttleTargets.length > 0 ? throttleTargets : selectedThrottleTargets}
        onApply={handleBulkThrottle}
        isPending={throttleMutation.isPending}
      />
    </div>
  );
}
