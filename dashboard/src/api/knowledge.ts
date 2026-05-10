import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from './client';

export interface KnowledgeDomain {
  domain: string;
  count: number;
  latest: string;
}

export interface KnowledgeEntry {
  id: string;
  domain: string;
  key: string;
  data: Record<string, unknown>;
  tags: string[];
  created_at: string;
  updated_at: string;
}

export interface ListDomainsResponse {
  domains: KnowledgeDomain[];
}

export interface ListEntriesResponse {
  entries: KnowledgeEntry[];
  total: number;
}

export function useListDomains() {
  return useQuery<ListDomainsResponse>({
    queryKey: ['knowledge', 'domains'],
    queryFn: () => apiFetch('/knowledge/domains'),
  });
}

export function useListKnowledge(
  domain: string,
  opts?: { tags?: string[]; search?: string; limit?: number; offset?: number },
) {
  const params = new URLSearchParams();
  params.set('domain', domain);
  if (opts?.tags?.length) params.set('tags', opts.tags.join(','));
  if (opts?.search) params.set('search', opts.search);
  if (opts?.limit != null) params.set('limit', String(opts.limit));
  if (opts?.offset != null) params.set('offset', String(opts.offset));
  const qs = params.toString();

  return useQuery<ListEntriesResponse>({
    queryKey: ['knowledge', domain, opts?.tags, opts?.search, opts?.limit, opts?.offset],
    queryFn: () => apiFetch(`/knowledge/entries?${qs}`),
    enabled: !!domain,
  });
}

export function useGetKnowledge(domain: string, key: string | null) {
  const params = new URLSearchParams();
  if (domain) params.set('domain', domain);
  if (key) params.set('key', key);
  const qs = params.toString();

  return useQuery<KnowledgeEntry & { found?: boolean }>({
    queryKey: ['knowledge', domain, key],
    queryFn: () => apiFetch(`/knowledge/entry?${qs}`),
    enabled: !!domain && !!key,
  });
}

export function useStoreKnowledge() {
  const queryClient = useQueryClient();
  return useMutation<
    { id: string; domain: string; key: string; created: boolean; updated_at: string },
    Error,
    { domain: string; key: string; data: Record<string, unknown>; tags?: string[]; replace?: boolean }
  >({
    mutationFn: (body) =>
      apiFetch('/knowledge/entry', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['knowledge'] });
    },
  });
}

export function useSetKnowledgeField() {
  const queryClient = useQueryClient();
  return useMutation<
    { id: string; domain: string; key: string; created: boolean; updated_at: string },
    Error,
    { domain: string; key: string; path: string; value: unknown; tags?: string[] }
  >({
    mutationFn: (body) =>
      apiFetch('/knowledge/field', {
        method: 'PUT',
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['knowledge'] });
    },
  });
}

export function useRemoveKnowledgeField() {
  const queryClient = useQueryClient();
  return useMutation<
    { removed: boolean },
    Error,
    { domain: string; key: string; path: string }
  >({
    mutationFn: ({ domain, key, path }) => {
      const params = new URLSearchParams({ domain, key, path });
      return apiFetch(`/knowledge/field?${params}`, { method: 'DELETE' });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['knowledge'] });
    },
  });
}

export function useDeleteKnowledge() {
  const queryClient = useQueryClient();
  return useMutation<
    { deleted: boolean; domain: string; key: string },
    Error,
    { domain: string; key: string }
  >({
    mutationFn: ({ domain, key }) => {
      const params = new URLSearchParams({ domain, key });
      return apiFetch(`/knowledge/entry?${params}`, { method: 'DELETE' });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['knowledge'] });
    },
  });
}
