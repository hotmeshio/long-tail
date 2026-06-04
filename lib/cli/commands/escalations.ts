import pc from 'picocolors';
import { apiFetch } from '../client';
import { output, formatTime, formatStatus } from '../format';

const COLUMNS = [
  { key: 'id', label: 'ID', width: 12, format: (v: string) => v?.slice(0, 12) || '' },
  { key: 'type', label: 'Type', width: 16 },
  { key: 'role', label: 'Role', width: 12 },
  { key: 'status', label: 'Status', width: 10, format: formatStatus },
  { key: 'priority', label: 'Pri', width: 4, align: 'right' as const },
  { key: 'created_at', label: 'Created', width: 12, format: formatTime },
];

interface ListOptions { status?: string; role?: string; limit?: string; json?: boolean; quiet?: boolean }

export async function listEscalations(opts: ListOptions): Promise<void> {
  const params = new URLSearchParams();
  if (opts.status) params.set('status', opts.status);
  if (opts.role) params.set('role', opts.role);
  if (opts.limit) params.set('limit', opts.limit);
  const data = await apiFetch<any>(`/escalations?${params}`);
  output(data, data.escalations || [], COLUMNS, opts);
}

export async function getEscalation(id: string, opts: { json?: boolean }): Promise<void> {
  const data = await apiFetch<any>(`/escalations/${id}`);
  if (opts.json) { console.log(JSON.stringify(data, null, 2)); return; }
  console.log(`\n  ${pc.bold(data.type)} ${pc.dim(data.id)}`);
  console.log(`  Status: ${formatStatus(data.status)}  Priority: ${data.priority}  Role: ${data.role}`);
  if (data.description) console.log(`  ${data.description}`);
  if (data.assigned_to) console.log(`  Assigned: ${data.assigned_to}`);
  console.log(`  Created: ${formatTime(data.created_at)}  Updated: ${formatTime(data.updated_at)}`);
  console.log();
}

export async function claimEscalation(id: string, opts: { duration?: string }): Promise<void> {
  const body: any = {};
  if (opts.duration) body.durationMinutes = parseInt(opts.duration, 10);
  const data = await apiFetch<any>(`/escalations/${id}/claim`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  console.log(`\n  ${pc.green('✓')} Claimed ${pc.dim(id)}\n`);
}

export async function releaseEscalation(id: string): Promise<void> {
  await apiFetch(`/escalations/${id}/release`, { method: 'POST' });
  console.log(`\n  ${pc.green('✓')} Released ${pc.dim(id)}\n`);
}

export async function resolveEscalation(id: string, opts: { data?: string }): Promise<void> {
  const resolverPayload = opts.data ? JSON.parse(opts.data) : {};
  await apiFetch(`/escalations/${id}/resolve`, {
    method: 'POST',
    body: JSON.stringify({ resolverPayload }),
  });
  console.log(`\n  ${pc.green('✓')} Resolved ${pc.dim(id)}\n`);
}

// --- Metadata candidate key commands ----------------------------------------

export async function findByMetadata(key: string, value: string, opts: ListOptions): Promise<void> {
  const params = new URLSearchParams({ key, value });
  if (opts.status) params.set('status', opts.status);
  if (opts.limit) params.set('limit', opts.limit);
  const data = await apiFetch<any>(`/escalations/by-metadata?${params}`);
  output(data, data.escalations || [], COLUMNS, opts);
}

export async function claimByMetadata(key: string, value: string, opts: { duration?: string; assignee?: string; meta?: string }): Promise<void> {
  const body: any = { key, value };
  if (opts.duration) body.durationMinutes = parseInt(opts.duration, 10);
  if (opts.assignee) body.assignee = opts.assignee;
  if (opts.meta) body.metadata = JSON.parse(opts.meta);
  const data = await apiFetch<any>('/escalations/claim-by-metadata', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  console.log(`\n  ${pc.green('✓')} Claimed ${pc.dim(data.escalation?.id || '')} by ${key}=${value}\n`);
}

export async function resolveByMetadata(key: string, value: string, opts: { data?: string; assignee?: string; meta?: string }): Promise<void> {
  const resolverPayload = opts.data ? JSON.parse(opts.data) : {};
  const body: any = { key, value, resolverPayload };
  if (opts.assignee) body.assignee = opts.assignee;
  if (opts.meta) body.metadata = JSON.parse(opts.meta);
  await apiFetch('/escalations/resolve-by-metadata', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  console.log(`\n  ${pc.green('✓')} Resolved by ${key}=${value}\n`);
}
