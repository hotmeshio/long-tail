import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from './client';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface MaintenanceRule {
  target: 'streams' | 'jobs';
  action: 'delete' | 'prune';
  olderThan: string;
  hasEntity?: boolean;
  pruned?: boolean;
}

export interface MaintenanceConfig {
  schedule: string;
  rules: MaintenanceRule[];
}

export interface PruneOptions {
  expire?: string;
  jobs?: boolean;
  streams?: boolean;
  attributes?: boolean;
  entities?: string[];
  pruneTransient?: boolean;
  keepHmark?: boolean;
}

export interface PruneResult {
  jobs?: number;
  streams?: number;
  attributes?: number;
  transient?: number;
  marked?: number;
}

// ── Maintenance config ────────────────────────────────────────────────────────

export function useMaintenanceConfig() {
  return useQuery<{ config: MaintenanceConfig; active: boolean }>({
    queryKey: ['maintenance'],
    queryFn: () => apiFetch('/config/maintenance'),
  });
}

export function useUpdateMaintenanceConfig() {
  const queryClient = useQueryClient();
  return useMutation<
    { config: MaintenanceConfig; restarted: boolean },
    Error,
    MaintenanceConfig
  >({
    mutationFn: (config) =>
      apiFetch('/config/maintenance', {
        method: 'PUT',
        body: JSON.stringify(config),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['maintenance'] });
    },
  });
}

// ── DBA operations ────────────────────────────────────────────────────────────

export function usePrune() {
  return useMutation<PruneResult, Error, PruneOptions>({
    mutationFn: (options) =>
      apiFetch('/dba/prune', {
        method: 'POST',
        body: JSON.stringify(options),
      }),
  });
}

export function useDeploy() {
  return useMutation<{ ok: boolean }, Error, void>({
    mutationFn: () =>
      apiFetch('/dba/deploy', { method: 'POST' }),
  });
}
