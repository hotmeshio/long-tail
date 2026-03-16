import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from './client';

// ── Types ───────────────────────────────────────────────────────────────────

export interface ControlPlaneApp {
  appId: string;
}

export interface QuorumProfile {
  namespace: string;
  app_id: string;
  engine_id: string;
  entity?: string;
  worker_topic?: string;
  stream?: string;
  stream_depth?: number;
  counts?: Record<string, number>;
  inited?: string;
  timestamp?: string;
  throttle?: number;
  reclaimDelay?: number;
  reclaimCount?: number;
  system?: {
    TotalMemoryGB: string;
    FreeMemoryGB: string;
    UsedMemoryGB: string;
    CPULoad: Array<Record<string, string>>;
    NetworkStats: Array<Record<string, unknown>>;
  };
  signature?: string;
}

// ── API functions ───────────────────────────────────────────────────────────

function fetchApps() {
  return apiFetch<{ apps: ControlPlaneApp[] }>('/controlplane/apps');
}

function fetchRollCall(appId: string) {
  return apiFetch<{ profiles: QuorumProfile[] }>(`/controlplane/rollcall?app_id=${encodeURIComponent(appId)}`);
}

function postThrottle(body: { appId: string; throttle: number; topic?: string; guid?: string }) {
  return apiFetch<{ success: boolean }>('/controlplane/throttle', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

function postSubscribe(body: { appId: string }) {
  return apiFetch<{ subscribed: boolean; appId: string }>('/controlplane/subscribe', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export interface StreamStats {
  pending: number;
  processed: number;
  byStream: Array<{ stream_type: 'engine' | 'worker'; stream_name: string; count: number }>;
}

function fetchStreamStats(appId: string, duration: string, stream?: string) {
  let url = `/controlplane/streams?app_id=${encodeURIComponent(appId)}&duration=${encodeURIComponent(duration)}`;
  if (stream) url += `&stream=${encodeURIComponent(stream)}`;
  return apiFetch<StreamStats>(url);
}

// ── Hooks ───────────────────────────────────────────────────────────────────

export function useControlPlaneApps() {
  return useQuery({
    queryKey: ['controlplane', 'apps'],
    queryFn: fetchApps,
    staleTime: 60_000,
  });
}

export function useRollCall(appId: string) {
  return useQuery({
    queryKey: ['controlplane', 'rollcall', appId],
    queryFn: () => fetchRollCall(appId),
    enabled: !!appId,
    refetchInterval: false,
  });
}

export function useThrottle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: postThrottle,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['controlplane', 'rollcall'] });
    },
  });
}

export function useStreamStats(appId: string, duration: string, stream?: string) {
  return useQuery({
    queryKey: ['controlplane', 'streams', appId, duration, stream ?? ''],
    queryFn: () => fetchStreamStats(appId, duration, stream),
    enabled: !!appId,
    staleTime: 15_000,
  });
}

export function useSubscribeMesh() {
  return useMutation({
    mutationFn: postSubscribe,
  });
}
