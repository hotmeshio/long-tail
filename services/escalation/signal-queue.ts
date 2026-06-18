import { createClient } from '../../workers';
import type {
  SignalQueueEntry,
  ClaimSignalResult,
  ReleaseSignalResult,
  ResolveSignalResult,
} from '@hotmeshio/hotmesh/build/types/signal';

export async function sqList(params: {
  role?: string;
  status?: 'pending' | 'claimed' | 'resolved' | 'expired' | 'released';
  taskQueue?: string;
  limit?: number;
  offset?: number;
}): Promise<SignalQueueEntry[]> {
  const client = createClient();
  return client.signalQueue.list(params);
}

export async function sqGet(id: string): Promise<SignalQueueEntry | null> {
  const client = createClient();
  return client.signalQueue.get(id);
}

/**
 * Find a signal queue entry by its signal key.
 *
 * Signal keys are unique per workflow instance, so at most one entry
 * matches. Uses list() + filter since the client API does not expose
 * a signalKey-indexed lookup directly.
 */
export async function sqGetBySignalKey(signalKey: string): Promise<SignalQueueEntry | null> {
  const client = createClient();
  const entries: SignalQueueEntry[] = await client.signalQueue.list({ limit: 200 });
  return entries.find(e => e.signalKey === signalKey) ?? null;
}

export async function sqClaim(params: {
  id: string;
  assignee?: string;
  durationMinutes?: number;
}): Promise<ClaimSignalResult> {
  const client = createClient();
  return client.signalQueue.claim(params);
}

export async function sqClaimByMetadata(params: {
  key: string;
  value: unknown;
  assignee?: string;
  durationMinutes?: number;
}): Promise<ClaimSignalResult> {
  const client = createClient();
  return client.signalQueue.claimByMetadata(params);
}

export async function sqRelease(id: string): Promise<ReleaseSignalResult> {
  const client = createClient();
  return client.signalQueue.release({ id });
}

export async function sqResolve(params: {
  id: string;
  resolverPayload?: Record<string, unknown>;
}): Promise<ResolveSignalResult> {
  const client = createClient();
  return client.signalQueue.resolve(params);
}

export async function sqResolveByMetadata(params: {
  key: string;
  value: unknown;
  resolverPayload?: Record<string, unknown>;
}): Promise<ResolveSignalResult> {
  const client = createClient();
  return client.signalQueue.resolveByMetadata(params);
}

export async function sqReleaseExpired(): Promise<number> {
  const client = createClient();
  return client.signalQueue.releaseExpired();
}
