import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from './client';

export interface TopicCatalogEntry {
  topic: string;
  description?: string;
  category: string;
  payload_schema?: Record<string, any>;
  example_payload?: Record<string, any>;
  source: string;
  tags: string[];
  managed: boolean;
  subscriber_count?: number;
  last_seen_at?: string;
  created_at: string;
  updated_at: string;
}

export interface TopicSubscriber {
  id: string;
  agent_id: string;
  agent_name: string;
  topic: string;
  reaction_type: string;
}

export interface TopicDetail extends TopicCatalogEntry {
  subscribers: TopicSubscriber[];
}

interface TopicListResponse {
  topics: TopicCatalogEntry[];
  total: number;
}

interface TopicFilters {
  category?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

export function useTopics(filters: TopicFilters = {}) {
  const params = new URLSearchParams();
  if (filters.category) params.set('category', filters.category);
  if (filters.search) params.set('search', filters.search);
  if (filters.limit != null) params.set('limit', String(filters.limit));
  if (filters.offset != null) params.set('offset', String(filters.offset));
  const qs = params.toString();

  return useQuery<TopicListResponse>({
    queryKey: ['topics', filters],
    queryFn: () => apiFetch(`/topics${qs ? `?${qs}` : ''}`),
  });
}

export function useTopic(topic: string | null) {
  return useQuery<TopicDetail>({
    queryKey: ['topics', 'detail', topic],
    queryFn: () => apiFetch(`/topics/by-name/${encodeURIComponent(topic!)}`),
    enabled: !!topic,
  });
}

export function useCreateTopic() {
  const queryClient = useQueryClient();
  return useMutation<TopicCatalogEntry, Error, Partial<TopicCatalogEntry> & { topic: string; category: string }>({
    mutationFn: (body) =>
      apiFetch('/topics', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['topics'] });
    },
  });
}

export function useUpdateTopic() {
  const queryClient = useQueryClient();
  return useMutation<TopicCatalogEntry, Error, { topic: string } & Partial<TopicCatalogEntry>>({
    mutationFn: ({ topic, ...body }) =>
      apiFetch(`/topics/by-name/${encodeURIComponent(topic)}`, {
        method: 'PUT',
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['topics'] });
    },
  });
}

export function useDeleteTopic() {
  const queryClient = useQueryClient();
  return useMutation<{ deleted: boolean }, Error, string>({
    mutationFn: (topic) =>
      apiFetch(`/topics/by-name/${encodeURIComponent(topic)}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['topics'] });
    },
  });
}

export function usePublishTopic() {
  return useMutation<{ published: boolean; topic: string; timestamp: string }, Error, { topic: string; subject?: string; data: Record<string, any> }>({
    mutationFn: ({ topic, subject, data }) =>
      apiFetch(`/topics/by-name/${encodeURIComponent(topic)}/publish`, {
        method: 'POST',
        body: JSON.stringify({ subject, data }),
      }),
  });
}
