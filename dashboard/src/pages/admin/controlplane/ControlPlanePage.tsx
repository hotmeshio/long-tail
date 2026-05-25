import { useMemo, useState, useCallback, useEffect } from 'react';
import { RefreshCw } from 'lucide-react';
import { PageHeaderWithStats, type InlineStat } from '../../../components/common/layout/PageHeaderWithStats';
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
  groupByQueue,
  type Duration,
} from './helpers';
import { useMeshSelection } from './useMeshSelection';
import { ThrottleModal } from './ThrottleModal';
import { EmergencyControls } from './EmergencyControls';
import { ControlPlaneContent } from './ControlPlaneContent';

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
    throttleModalOpen,
    throttleTargets,
    selectedThrottleTargets,
    throttleMutation,
    handleBulkThrottle,
    handleRowClick,
    handleResumeThrottle,
    handleResumeQueue,
    handleQueueThrottle,
    closeThrottleModal,
  } = useMeshSelection({ activeAppId, allProfiles, profiles: allProfiles });

  // ── Header stats ──────────────────────────────────────────────
  const headerStats = useMemo((): InlineStat[] => {
    const stats: InlineStat[] = [
      { label: 'Engines', value: engines.length, dotClass: 'bg-blue-500' },
      { label: 'Workers', value: workers.length, dotClass: 'bg-text-secondary' },
      { label: 'Topics', value: queueMap.size },
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
        title="Routers"
        docsHash="#docs:dashboard.md:task-queues"
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

      <ControlPlaneContent
        collapsed={collapsed}
        toggleSection={toggleSection}
        activeDuration={activeDuration}
        streamStats={streamStats}
        isLoading={isLoading}
        queueMap={queueMap}
        expandedQueues={expandedQueues}
        toggleQueue={toggleQueue}
        allQueuesExpanded={allQueuesExpanded}
        toggleAllQueues={toggleAllQueues}
        handleRowClick={handleRowClick}
        handleResumeThrottle={handleResumeThrottle}
        handleQueueThrottle={handleQueueThrottle}
        handleResumeQueue={handleResumeQueue}
        engines={engines}
        bridgeActive={bridgeActive}
      />

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
