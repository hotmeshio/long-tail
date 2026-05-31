import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from './client';

export interface AgentSubscription {
  id: string;
  agent_id: string;
  topic: string;
  filter?: Record<string, any>;
  reaction_type: 'durable' | 'pipeline' | 'mcp_query' | 'capability';
  workflow_type?: string;
  pipeline_id?: string;
  mcp_prompt?: string;
  server_id?: string;
  tool_name?: string;
  input_mapping: Record<string, any>;
  execute_as?: string;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

interface SubscriptionListResponse {
  subscriptions: AgentSubscription[];
}

export function useAgentSubscriptions(agentId: string | null) {
  return useQuery<SubscriptionListResponse>({
    queryKey: ['agent-subscriptions', agentId],
    queryFn: () => apiFetch(`/agents/${agentId}/subscriptions`),
    enabled: !!agentId,
  });
}

export function useCreateSubscription() {
  const queryClient = useQueryClient();
  return useMutation<AgentSubscription, Error, { agentId: string } & Partial<AgentSubscription>>({
    mutationFn: ({ agentId, ...body }) =>
      apiFetch(`/agents/${agentId}/subscriptions`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ['agent-subscriptions', vars.agentId] });
      queryClient.invalidateQueries({ queryKey: ['agents'] });
    },
  });
}

export function useUpdateSubscription() {
  const queryClient = useQueryClient();
  return useMutation<AgentSubscription, Error, { agentId: string; subId: string } & Partial<AgentSubscription>>({
    mutationFn: ({ agentId, subId, ...body }) =>
      apiFetch(`/agents/${agentId}/subscriptions/${subId}`, {
        method: 'PUT',
        body: JSON.stringify(body),
      }),
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ['agent-subscriptions', vars.agentId] });
    },
  });
}

export function useDeleteSubscription() {
  const queryClient = useQueryClient();
  return useMutation<{ deleted: boolean }, Error, { agentId: string; subId: string }>({
    mutationFn: ({ agentId, subId }) =>
      apiFetch(`/agents/${agentId}/subscriptions/${subId}`, { method: 'DELETE' }),
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ['agent-subscriptions', vars.agentId] });
      queryClient.invalidateQueries({ queryKey: ['agents'] });
    },
  });
}
