import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from './client';

export interface EscalationChain {
  source_role: string;
  target_role: string;
}

export interface RoleDetail {
  role: string;
  user_count: number;
  chain_count: number;
  workflow_count: number;
}

export function useRoles() {
  return useQuery<{ roles: string[] }>({
    queryKey: ['roles'],
    queryFn: () => apiFetch('/roles'),
  });
}

export function useEscalationChains() {
  return useQuery<{ chains: EscalationChain[] }>({
    queryKey: ['roles', 'escalation-chains'],
    queryFn: () => apiFetch('/roles/escalation-chains'),
  });
}

export function useEscalationTargets(role: string) {
  return useQuery<{ targets: string[] }>({
    queryKey: ['roles', role, 'escalation-targets'],
    queryFn: () => apiFetch(`/roles/${encodeURIComponent(role)}/escalation-targets`),
    enabled: !!role,
  });
}

export function useUpdateEscalationTargets() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ role, targets }: { role: string; targets: string[] }) =>
      apiFetch(`/roles/${encodeURIComponent(role)}/escalation-targets`, {
        method: 'PUT',
        body: JSON.stringify({ targets }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['roles'] });
    },
  });
}

export function useAddEscalationChain() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (chain: EscalationChain) =>
      apiFetch('/roles/escalation-chains', {
        method: 'POST',
        body: JSON.stringify(chain),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['roles'] });
    },
  });
}

export function useRemoveEscalationChain() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (chain: EscalationChain) =>
      apiFetch('/roles/escalation-chains', {
        method: 'DELETE',
        body: JSON.stringify(chain),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['roles'] });
    },
  });
}

export function useRoleDetails() {
  return useQuery<{ roles: RoleDetail[] }>({
    queryKey: ['roles', 'details'],
    queryFn: () => apiFetch('/roles/details'),
  });
}

export function useCreateRole() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (role: string) =>
      apiFetch('/roles', {
        method: 'POST',
        body: JSON.stringify({ role }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['roles'] });
    },
  });
}

export function useDeleteRole() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (role: string) =>
      apiFetch(`/roles/${encodeURIComponent(role)}`, {
        method: 'DELETE',
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['roles'] });
    },
  });
}
