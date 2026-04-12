import { useMemo, useState, useCallback, useEffect } from 'react';
import { RefreshCw } from 'lucide-react';
import { PageHeaderWithStats, type InlineStat } from '../../../components/common/layout/PageHeaderWithStats';
import { DataTable } from '../../../components/common/data/DataTable';
import { CollapsibleSection } from '../../../components/common/layout/CollapsibleSection';
import { FilterBar, FilterSelect } from '../../../components/common/data/FilterBar';
import { useFilterParams } from '../../../hooks/useFilterParams';
import {
  useControlPlaneApps,
  useRollCall,
  useStreamStats,
  useSubscribeMesh,
} from '../../../api/controlplane';
import {
  DURATIONS,
  isWorker,
  isThrottled,
  rowKey,
  groupByQueue,
  type Duration,
} from './helpers';
import { getEngineColumns } from './columns';
import { useMeshSelection } from './useMeshSelection';
import { ThrottleModal } from './ThrottleModal';
import { StreamVolumeChart } from './StreamVolumeChart';
import { QuorumFeed } from './QuorumFeed';
import { QueueCard } from './QueueCard';
import { EmergencyControls } from './EmergencyControls';

export function ControlPlanePage() {
  const { data: appsData } = useControlPlaneApps();
  const apps = appsData?.apps ?? [];

  const { filters, setFilter } = useFilterParams({
    filters: { app_id: '', duration: '1h' },
  });

  const firstAppId = apps[0]?.appId ?? 'durable';
  const activeAppId = filters.app_id || firstAppId;
  const activeDuration = (filters.duration || '1h') as Duration;

  const subscribeMesh = useSubscribeMesh();

  const REFRESH_INTERVAL = 60_000;

  const { data: rollCallData, isLoading, error: rollCallError, refetch, isFetching } = useRollCall(activeAppId, REFRESH_INTERVAL);
  const { data: streamStats } = useStreamStats(activeAppId, activeDuration, undefined, REFRESH_INTERVAL);

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

  // ── Derived data ──────────────────────────────────────────────
  const engines = useMemo(() => allProfiles.filter((p) => !isWorker(p)), [allProfiles]);
  const workers = useMemo(() => allProfiles.filter(isWorker), [allProfiles]);
  const queueMap = useMemo(() => groupByQueue(allProfiles), [allProfiles]);
  const throttledCount = allProfiles.filter(isThrottled).length;

  const appOptions = useMemo(() => {
    const ids = new Set(apps.map((a) => a.appId));
    if (activeAppId) ids.add(activeAppId);
    return [...ids].sort().map((id) => ({ value: id, label: id }));
  }, [apps, activeAppId]);

  // ── Queue card expand/collapse state ───────────────────────────
  const [expandedQueues, setExpandedQueues] = useState<Set<string>>(new Set());
  const toggleQueue = useCallback((queue: string) => {
    setExpandedQueues((prev) => {
      const next = new Set(prev);
      if (next.has(queue)) next.delete(queue);
      else next.add(queue);
      return next;
    });
  }, []);
  const allQueuesExpanded = queueMap.size > 0 && [...queueMap.keys()].every((q) => expandedQueues.has(q));
  const toggleAllQueues = useCallback(() => {
    if (allQueuesExpanded) setExpandedQueues(new Set());
    else setExpandedQueues(new Set(queueMap.keys()));
  }, [allQueuesExpanded, queueMap]);

  // ── Section collapse state (persisted) ─────────────────────────
  const STORAGE_KEY = 'lt:controlplane:collapsed';
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    } catch { return {}; }
  });
  const toggleSection = useCallback((key: string) => {
    setCollapsed((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  // ── Selection + throttle logic ─────────────────────────────
  const {
    selectedIds,
    setSelectedIds,
    toggleCheckbox,
    toggleAll,
    throttleModalOpen,
    throttleTargets,
    selectedThrottleTargets,
    throttleMutation,
    handleBulkThrottle,
    handleRowClick,
    handleBulkThrottleOpen,
    handleResumeThrottle,
    handleResumeQueue,
    handleQueueThrottle,
    closeThrottleModal,
  } = useMeshSelection({ activeAppId, allProfiles, profiles: allProfiles });

  // ── Engine-scoped toggle ───────────────────────────────────────
  const toggleAllEngines = useCallback(() => {
    const engineKeys = new Set(engines.map(rowKey));
    const allSelected = engines.length > 0 && engines.every((e) => selectedIds.has(rowKey(e)));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const k of engineKeys) {
        if (allSelected) next.delete(k);
        else next.add(k);
      }
      return next;
    });
  }, [engines, selectedIds, setSelectedIds]);

  // ── Engine bulk throttle (header icon) ─────────────────────────
  const handleEngineBulkThrottle = useCallback(() => {
    const selected = engines.filter((e) => selectedIds.has(rowKey(e)));
    if (selected.length === 0) return;
    handleBulkThrottleOpen();
  }, [engines, selectedIds, handleBulkThrottleOpen]);

  // ── Engine column definitions ─────────────────────────────────
  const engineColumns = useMemo(
    () => getEngineColumns({
      profiles: engines,
      selectedIds,
      toggleAll: toggleAllEngines,
      toggleCheckbox,
      onRowThrottle: handleRowClick,
      onResumeThrottle: handleResumeThrottle,
      onBulkThrottle: handleEngineBulkThrottle,
    }),
    [engines, selectedIds, toggleAllEngines, toggleCheckbox, handleRowClick, handleResumeThrottle, handleEngineBulkThrottle],
  );

  // ── Header stats ──────────────────────────────────────────────
  const headerStats = useMemo((): InlineStat[] => {
    const stats: InlineStat[] = [
      { label: 'Engines', value: engines.length, dotClass: 'bg-blue-500' },
      { label: 'Workers', value: workers.length, dotClass: 'bg-text-secondary' },
      { label: 'Queues', value: queueMap.size },
    ];
    if (throttledCount > 0) {
      stats.push({ label: 'Throttled', value: throttledCount, dotClass: 'bg-status-warning' });
    }
    return stats;
  }, [engines.length, workers.length, queueMap.size, throttledCount]);

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

  return (
    <div>
      <PageHeaderWithStats
        title="Task Queues"
        stats={headerStats}
        actions={<EmergencyControls />}
      />

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

      {/* Main content: sections (left) + quorum feed (right) */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-6">
        <div className="flex flex-col gap-12 mt-10">
          {/* Stream Volume section */}
          <CollapsibleSection
            title={`Stream Volume (${activeDuration})`}
            sectionKey="volume"
            isCollapsed={!!collapsed.volume}
            onToggle={toggleSection}
            contentClassName="mt-4 ml-7"
          >
            <StreamVolumeChart
              byStream={streamStats?.byStream ?? []}
              onNodeFilter={() => {}}
              onQueueFilter={() => {}}
            />
          </CollapsibleSection>

          {/* Task Queues section */}
          <CollapsibleSection
            title="Worker Queues"
            sectionKey="queues"
            isCollapsed={!!collapsed.queues}
            onToggle={toggleSection}
            contentClassName="mt-4 ml-7 flex flex-col gap-0"
          >
            {isLoading ? (
              <p className="text-xs text-text-tertiary">Discovering mesh nodes...</p>
            ) : queueMap.size === 0 ? (
              <p className="text-xs text-text-tertiary">No worker queues found. Click "Roll Call" to discover.</p>
            ) : (
              <>
                <div className="flex justify-end mb-2">
                  <button onClick={toggleAllQueues} className="text-[10px] text-accent hover:underline">
                    {allQueuesExpanded ? 'Collapse all' : 'Expand all'}
                  </button>
                </div>
                {[...queueMap.entries()]
                  .sort(([a], [b]) => a.localeCompare(b))
                  .map(([queue, qWorkers]) => (
                    <QueueCard
                      key={queue}
                      queue={queue}
                      workers={qWorkers}
                      expanded={expandedQueues.has(queue)}
                      onToggle={toggleQueue}
                      onWorkerClick={handleRowClick}
                      onResumeThrottle={handleResumeThrottle}
                      onQueueThrottle={handleQueueThrottle}
                      onResumeQueue={handleResumeQueue}
                    />
                  ))}
              </>
            )}
          </CollapsibleSection>

          {/* Engines section */}
          <CollapsibleSection
            title="Engines"
            sectionKey="engines"
            isCollapsed={!!collapsed.engines}
            onToggle={toggleSection}
            contentClassName="mt-4 ml-7"
          >
            <DataTable
              columns={engineColumns}
              data={engines}
              keyFn={rowKey}
              onRowClick={handleRowClick}
              isLoading={isLoading}
              emptyMessage={isLoading ? 'Discovering engines...' : 'No engines found.'}
              inline
            />
          </CollapsibleSection>
        </div>

        <QuorumFeed bridgeActive={bridgeActive} />
      </div>

      <ThrottleModal
        open={throttleModalOpen}
        onClose={closeThrottleModal}
        targets={throttleTargets.length > 0 ? throttleTargets : selectedThrottleTargets}
        onApply={handleBulkThrottle}
        isPending={throttleMutation.isPending}
      />
    </div>
  );
}
