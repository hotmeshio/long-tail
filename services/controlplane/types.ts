/** Type definitions for the control plane service. */

export interface ControlPlaneApp {
  appId: string;
  version: string;
}

export interface StreamStats {
  pending: number;
  processed: number;
  byStream: Array<{ stream_type: 'engine' | 'worker'; stream_name: string; count: number }>;
}

// ─── Stream message browsing ──────────────────────────────────────────────

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
  /** Worker-only fields (null for engine messages) */
  workflow_name: string | null;
  jid: string | null;
  aid: string | null;
  dad: string | null;
  msg_type: string | null;
  topic: string | null;
}

export interface StreamMessagesParams {
  source: StreamMessageSource;
  limit?: number;
  offset?: number;
  sort_by?: string;
  order?: 'asc' | 'desc';
  stream_name?: string | null;
  status?: StreamMessageStatus | null;
  msg_type?: string | null;
}

export interface StreamMessagesResult {
  messages: StreamMessage[];
  total: number;
}
