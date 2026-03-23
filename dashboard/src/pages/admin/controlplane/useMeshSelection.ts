import { useState, useCallback, useEffect, useMemo } from 'react';

import type { QuorumProfile } from '../../../api/controlplane';
import { useThrottle } from '../../../api/controlplane';
import { isWorker, rowKey, type ThrottleTarget } from './helpers';

interface UseMeshSelectionOptions {
  activeAppId: string;
  allProfiles: QuorumProfile[];
  profiles: QuorumProfile[];
}

export function useMeshSelection({
  activeAppId,
  allProfiles,
  profiles,
}: UseMeshSelectionOptions) {
  const throttleMutation = useThrottle();

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [throttleModalOpen, setThrottleModalOpen] = useState(false);
  const [throttleTargets, setThrottleTargets] = useState<ThrottleTarget[]>([]);

  useEffect(() => { setSelectedIds(new Set()); }, [activeAppId]);

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
   * - All nodes selected -> no topic/guid (entire mesh)
   * - All engines selected -> topic = engine stream (all engines)
   * - All workers on a queue selected -> topic = queue (all workers on queue)
   * - Subset of a group -> individual guid targets
   */
  const selectedThrottleTargets = useMemo((): ThrottleTarget[] => {
    const selected = profiles.filter((p) => selectedIds.has(rowKey(p)));
    if (selected.length === 0) return [];

    // All nodes -> entire mesh
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
        targets.push({ label: 'All Engines', topic: engines[0].stream || '' });
      } else {
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
        targets.push({ label: queue, topic: queue });
      } else {
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

  const closeThrottleModal = () => {
    setThrottleModalOpen(false);
    setThrottleTargets([]);
  };

  return {
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
    closeThrottleModal,
  };
}
