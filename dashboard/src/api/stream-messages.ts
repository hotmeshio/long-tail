import { useQuery } from '@tanstack/react-query';
import { apiFetch } from './client';

// ── Types ───────────────────────────────────────────────────────────────────

export type StreamMessageStatus = 'pending' | 'claimed' | 'processed' | 'dead_lettered';
export type StreamMessageSource = 'engine' | 'worker';

export interface StreamMessage {
  id: string;
  source: StreamMessageSource;
  stream_name: string;
  message: string;
  status: StreamMessageStatus;
  created_at: string;
  reserved_at: string | null;
  reserved_by: string | null;
  expired_at: string | null;
  dead_lettered_at: string | null;
  priority: number;
  visible_at: string | null;
  retry_attempt: number;
  max_retry_attempts: number;
  workflow_name: string | null;
  jid: string | null;
  aid: string | null;
  dad: string | null;
  msg_type: string | null;
  topic: string | null;
}

export interface StreamMessagesResponse {
  messages: StreamMessage[];
  total: number;
}

export interface StreamMessagesParams {
  namespace: string;
  source: StreamMessageSource;
  limit?: number;
  offset?: number;
  sort_by?: string;
  order?: 'asc' | 'desc';
  status?: StreamMessageStatus | '';
  stream_name?: string;
  msg_type?: string;
  topic?: string;
  workflow_name?: string;
  jid?: string;
  aid?: string;
  dad?: string;
}

// ── Fetch ───────────────────────────────────────────────────────────────────

function fetchStreamMessages(params: StreamMessagesParams) {
  const qs = new URLSearchParams();
  qs.set('namespace', params.namespace);
  qs.set('source', params.source);
  if (params.limit) qs.set('limit', String(params.limit));
  if (params.offset) qs.set('offset', String(params.offset));
  if (params.sort_by) qs.set('sort_by', params.sort_by);
  if (params.order) qs.set('order', params.order);
  if (params.status) qs.set('status', params.status);
  if (params.stream_name) qs.set('stream_name', params.stream_name);
  if (params.msg_type) qs.set('msg_type', params.msg_type);
  if (params.topic) qs.set('topic', params.topic);
  if (params.workflow_name) qs.set('workflow_name', params.workflow_name);
  if (params.jid) qs.set('jid', params.jid);
  if (params.aid) qs.set('aid', params.aid);
  if (params.dad) qs.set('dad', params.dad);
  return apiFetch<StreamMessagesResponse>(`/controlplane/stream-messages?${qs}`);
}

// ── Hook ────────────────────────────────────────────────────────────────────

export function useStreamMessages(params: StreamMessagesParams, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ['controlplane', 'stream-messages', params],
    queryFn: () => fetchStreamMessages(params),
    enabled: !!params.namespace && (options?.enabled ?? true),
    staleTime: 15_000,
  });
}
