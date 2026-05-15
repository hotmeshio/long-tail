import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from './client';

export interface AgentCapability {
  serverId: string;
  toolNames?: string[];
}

export interface AgentTrigger {
  event: string;
  filter?: Record<string, any>;
}

export interface AgentSchedule {
  cron: string;
  workflow_type: string;
  envelope?: Record<string, any>;
  execute_as?: string;
}

export interface AgentBehaviors {
  cron?: string;
  triggers?: AgentTrigger[];
  schedules?: AgentSchedule[];
  escalationRules?: Record<string, any>;
}

export interface Agent {
  id: string;
  name: string;
  description?: string;
  status: 'inactive' | 'active' | 'paused' | 'error';
  user_id?: string;
  knowledge_domain?: string;
  capabilities: AgentCapability[];
  behaviors: AgentBehaviors;
  goals?: string;
  rules?: string;
  workflow_type?: string;
  pipeline_id?: string;
  metadata: Record<string, any>;
  last_run_at?: string;
  subscription_count?: number;
  sub_topics?: string[];
  created_at: string;
  updated_at: string;
  stats?: {
    knowledge_count: number;
    escalation_count: number;
    last_execution_at?: string;
  };
}

interface AgentListResponse {
  agents: Agent[];
  total: number;
}

interface AgentFilters {
  status?: string;
  knowledge_domain?: string;
  limit?: number;
  offset?: number;
}

export function useAgents(filters: AgentFilters = {}) {
  const params = new URLSearchParams();
  if (filters.status) params.set('status', filters.status);
  if (filters.knowledge_domain) params.set('knowledge_domain', filters.knowledge_domain);
  if (filters.limit != null) params.set('limit', String(filters.limit));
  if (filters.offset != null) params.set('offset', String(filters.offset));
  const qs = params.toString();

  return useQuery<AgentListResponse>({
    queryKey: ['agents', filters],
    queryFn: () => apiFetch(`/agents${qs ? `?${qs}` : ''}`),
  });
}

export function useAgent(id: string | null) {
  return useQuery<Agent>({
    queryKey: ['agents', id],
    queryFn: () => apiFetch(`/agents/${id}`),
    enabled: !!id,
  });
}

export function useCreateAgent() {
  const queryClient = useQueryClient();
  return useMutation<Agent, Error, Partial<Agent> & { name: string }>({
    mutationFn: (body) =>
      apiFetch('/agents', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agents'] });
    },
  });
}

export function useUpdateAgent() {
  const queryClient = useQueryClient();
  return useMutation<Agent, Error, { id: string } & Partial<Agent>>({
    mutationFn: ({ id, ...body }) =>
      apiFetch(`/agents/${id}`, {
        method: 'PUT',
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agents'] });
    },
  });
}

export function useDeleteAgent() {
  const queryClient = useQueryClient();
  return useMutation<{ deleted: boolean }, Error, string>({
    mutationFn: (id) =>
      apiFetch(`/agents/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agents'] });
    },
  });
}
