import { useMemo, useState, useCallback, useEffect } from 'react';
import { RefreshCw } from 'lucide-react';
import { PageHeader } from '../../../components/common/layout/PageHeader';
import { StatCard } from '../../../components/common/data/StatCard';
import { DataTable, type Column } from '../../../components/common/data/DataTable';
import { SectionLabel } from '../../../components/common/layout/SectionLabel';
import { FilterBar, FilterSelect } from '../../../components/common/data/FilterBar';
import { TaskQueuePill } from '../../../components/common/display/TaskQueuePill';
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
import {
  DURATIONS,
  isWorker,
  isThrottled,
  formatThrottleHuman,
  formatMemory,
  rowKey,
  MAX_EVENTS,
  type Duration,
  type QuorumEvent,
} from './helpers';
import { ThrottleModal } from './ThrottleModal';
import { MeshBulkActionBar } from './MeshBulkActionBar';
import { StreamVolumeChart } from './StreamVolumeChart';
import { QuorumFeed } from './QuorumFeed';

let eventCounter = 0;

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

  const handleRowClick = (profile: QuorumProfile) => {
    const topic = profile.worker_topic || profile.stream || '';
    if (topic) {
      setThrottleTargets([topic]);
      setThrottleModalOpen(true);
    }
  };

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
          isWorker(row) ? 'bg-accent/10 text-accent' : 'bg-purple-500/10 text-purple-400'
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
        <StreamVolumeChart byStream={streamStats?.byStream ?? []} />
      </div>

      {/* Main content: table (left) + quorum feed (right) */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-6">
        <div>
          <SectionLabel className="mb-4">
            Mesh Nodes
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

        <QuorumFeed events={events} bridgeActive={bridgeActive} onClear={() => setEvents([])} />
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
