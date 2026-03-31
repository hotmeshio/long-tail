import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from './client';
import type { BotRecord, BotApiKeyRecord } from './types';
import type { LTRoleType } from './types';

interface BotListResponse {
  bots: BotRecord[];
  total: number;
}

interface BotFilters {
  limit?: number;
  offset?: number;
}

// ── Query hooks ──────────────────────────────────────────────────────────────

export function useBots(filters: BotFilters = {}) {
  const params = new URLSearchParams();
  if (filters.limit) params.set('limit', String(filters.limit));
  if (filters.offset !== undefined) params.set('offset', String(filters.offset));

  return useQuery<BotListResponse>({
    queryKey: ['bots', filters],
    queryFn: () => apiFetch(`/bot-accounts?${params}`),
  });
}

export function useBotApiKeys(botId: string) {
  return useQuery<{ keys: BotApiKeyRecord[] }>({
    queryKey: ['bots', botId, 'api-keys'],
    queryFn: () => apiFetch(`/bot-accounts/${botId}/api-keys`),
    enabled: !!botId,
  });
}

// ── Mutation hooks ───────────────────────────────────────────────────────────

export function useCreateBot() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      name: string;
      description?: string;
      display_name?: string;
      roles?: { role: string; type: LTRoleType }[];
    }) =>
      apiFetch('/bot-accounts', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bots'] });
    },
  });
}

export function useUpdateBot() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      ...data
    }: {
      id: string;
      display_name?: string;
      description?: string;
      status?: string;
    }) =>
      apiFetch(`/bot-accounts/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bots'] });
    },
  });
}

export function useDeleteBot() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/bot-accounts/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bots'] });
    },
  });
}

export function useCreateBotApiKey() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      botId,
      name,
      scopes,
    }: {
      botId: string;
      name: string;
      scopes?: string[];
    }) =>
      apiFetch<{ id: string; rawKey: string }>(`/bot-accounts/${botId}/api-keys`, {
        method: 'POST',
        body: JSON.stringify({ name, scopes }),
      }),
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ['bots', vars.botId, 'api-keys'] });
    },
  });
}

export function useRevokeBotApiKey() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ botId, keyId }: { botId: string; keyId: string }) =>
      apiFetch(`/bot-accounts/${botId}/api-keys/${keyId}`, { method: 'DELETE' }),
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ['bots', vars.botId, 'api-keys'] });
    },
  });
}

export function useAddBotRole() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      botId,
      role,
      type,
    }: {
      botId: string;
      role: string;
      type: LTRoleType;
    }) =>
      apiFetch(`/bot-accounts/${botId}/roles`, {
        method: 'POST',
        body: JSON.stringify({ role, type }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bots'] });
    },
  });
}

export function useRemoveBotRole() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ botId, role }: { botId: string; role: string }) =>
      apiFetch(`/bot-accounts/${botId}/roles/${encodeURIComponent(role)}`, {
        method: 'DELETE',
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bots'] });
    },
  });
}
