import pc from 'picocolors';
import { apiFetch } from '../client';
import { output, formatStatus, formatTime } from '../format';

const COLUMNS = [
  { key: 'id', label: 'ID', width: 12, format: (v: string) => v?.slice(0, 12) || '' },
  { key: 'name', label: 'Name', width: 24 },
  { key: 'app_id', label: 'Namespace', width: 14 },
  { key: 'status', label: 'Status', width: 10, format: formatStatus },
  { key: 'updated_at', label: 'Updated', width: 12, format: formatTime },
];

export async function listPipelines(opts: { status?: string; limit?: string; json?: boolean; quiet?: boolean }): Promise<void> {
  const params = new URLSearchParams();
  if (opts.status) params.set('status', opts.status);
  if (opts.limit) params.set('limit', opts.limit);
  const data = await apiFetch<any>(`/yaml-workflows?${params}`);
  const workflows = data.workflows || data;
  output(data, Array.isArray(workflows) ? workflows : [], COLUMNS, opts);
}

export async function getPipeline(id: string, opts: { json?: boolean }): Promise<void> {
  const data = await apiFetch<any>(`/yaml-workflows/${id}`);
  if (opts.json) { console.log(JSON.stringify(data, null, 2)); return; }
  console.log(`\n  ${pc.bold(data.name)} ${pc.dim(data.id)}`);
  console.log(`  Namespace: ${data.app_id}  Topic: ${data.graph_topic}  Status: ${formatStatus(data.status)}`);
  if (data.description) console.log(`  ${data.description}`);
  console.log(`  Activities: ${data.activity_manifest?.length || 0}  Version: ${data.app_version || '—'}`);
  console.log(`  Created: ${formatTime(data.created_at)}  Updated: ${formatTime(data.updated_at)}`);
  console.log();
}

export async function deployPipeline(id: string): Promise<void> {
  const data = await apiFetch<any>(`/yaml-workflows/${id}/deploy`, { method: 'POST' });
  console.log(`\n  ${pc.green('✓')} Deployed ${pc.bold(data.name || id)} → ${formatStatus(data.status || 'active')}\n`);
}

export async function invokePipeline(id: string, opts: { data?: string; sync?: boolean; json?: boolean }): Promise<void> {
  const inputData = opts.data ? JSON.parse(opts.data) : {};
  const body: any = { id, data: inputData };
  if (opts.sync) body.sync = true;
  const data = await apiFetch<any>(`/yaml-workflows/${id}/invoke`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  if (opts.json) { console.log(JSON.stringify(data, null, 2)); return; }
  console.log(`\n  ${pc.green('✓')} Invoked → ${pc.dim(data.job_id || data.workflowId || 'ok')}\n`);
}

export async function archivePipeline(id: string): Promise<void> {
  await apiFetch(`/yaml-workflows/${id}/archive`, { method: 'POST' });
  console.log(`\n  ${pc.green('✓')} Archived ${pc.dim(id)}\n`);
}
