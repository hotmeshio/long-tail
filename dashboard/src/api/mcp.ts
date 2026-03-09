import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from './client';
import type { McpServerRecord, McpToolManifest } from './types';

interface McpServerListResponse {
  servers: McpServerRecord[];
  total: number;
}

interface McpServerFilters {
  status?: string;
  search?: string;
}

export function useMcpServers(filters: McpServerFilters = {}) {
  const params = new URLSearchParams();
  if (filters.status) params.set('status', filters.status);
  if (filters.search) params.set('search', filters.search);
  const qs = params.toString();

  return useQuery<McpServerListResponse>({
    queryKey: ['mcpServers', filters],
    queryFn: () => apiFetch(`/mcp/servers${qs ? `?${qs}` : ''}`),
    refetchInterval: 30_000,
  });
}

export function useMcpServer(id: string) {
  return useQuery<McpServerRecord>({
    queryKey: ['mcpServers', id],
    queryFn: () => apiFetch(`/mcp/servers/${id}`),
    enabled: !!id,
  });
}

export function useCreateMcpServer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      name: string;
      description?: string;
      transport_type: string;
      transport_config: Record<string, unknown>;
      auto_connect?: boolean;
      metadata?: Record<string, unknown>;
    }) =>
      apiFetch('/mcp/servers', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mcpServers'] });
    },
  });
}

export function useUpdateMcpServer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      ...data
    }: {
      id: string;
      name?: string;
      description?: string;
      transport_type?: string;
      transport_config?: Record<string, unknown>;
      auto_connect?: boolean;
      metadata?: Record<string, unknown>;
    }) =>
      apiFetch(`/mcp/servers/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mcpServers'] });
    },
  });
}

export function useDeleteMcpServer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/mcp/servers/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mcpServers'] });
    },
  });
}

export function useConnectMcpServer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/mcp/servers/${id}/connect`, { method: 'POST' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mcpServers'] });
    },
  });
}

export function useDisconnectMcpServer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/mcp/servers/${id}/disconnect`, { method: 'POST' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mcpServers'] });
    },
  });
}

export function useMcpTools(serverId: string) {
  return useQuery<{ tools: McpToolManifest[] }>({
    queryKey: ['mcpTools', serverId],
    queryFn: () => apiFetch(`/mcp/servers/${serverId}/tools`),
    enabled: !!serverId,
  });
}

export function useCallMcpTool() {
  return useMutation({
    mutationFn: ({
      serverId,
      toolName,
      arguments: args,
    }: {
      serverId: string;
      toolName: string;
      arguments: Record<string, unknown>;
    }) =>
      apiFetch(`/mcp/servers/${serverId}/tools/${toolName}/call`, {
        method: 'POST',
        body: JSON.stringify({ arguments: args }),
      }),
  });
}
