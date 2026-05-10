import pc from 'picocolors';
import { apiFetch } from '../client';
import { output, formatStatus } from '../format';

const COLUMNS = [
  { key: 'workflow_type', label: 'Type', width: 24 },
  { key: 'task_queue', label: 'Queue', width: 16 },
  { key: 'tier', label: 'Tier', width: 12 },
  { key: 'active', label: 'Active', width: 8, format: (v: boolean) => v ? pc.green('yes') : pc.dim('no') },
  { key: 'invocable', label: 'Invocable', width: 10, format: (v: boolean) => v ? 'yes' : pc.dim('no') },
];

export async function listWorkflows(opts: { json?: boolean; quiet?: boolean; includeSystem?: boolean }): Promise<void> {
  const params = new URLSearchParams();
  if (opts.includeSystem) params.set('include_system', 'true');
  const data = await apiFetch<any>(`/workflows/discovered?${params}`);
  output(data, data.workflows || [], COLUMNS, opts, 'workflow_type');
}

export async function invokeWorkflow(type: string, opts: { data?: string; json?: boolean }): Promise<void> {
  const inputData = opts.data ? JSON.parse(opts.data) : {};
  const data = await apiFetch<any>(`/workflows/${type}/invoke`, {
    method: 'POST',
    body: JSON.stringify({ data: inputData }),
  });
  if (opts.json) { console.log(JSON.stringify(data, null, 2)); return; }
  console.log(`\n  ${pc.green('✓')} Started ${pc.bold(type)} → ${pc.dim(data.workflowId)}\n`);
}

export async function getWorkflowStatus(id: string, opts: { json?: boolean }): Promise<void> {
  const data = await apiFetch<any>(`/workflows/status/${id}`);
  if (opts.json) { console.log(JSON.stringify(data, null, 2)); return; }
  const status = data.status === 0 ? pc.green('completed') : pc.blue('running');
  console.log(`\n  ${data.workflowId}  ${status}\n`);
}

export async function getWorkflowResult(id: string, opts: { json?: boolean }): Promise<void> {
  const { server, token } = await (await import('../auth')).resolveAuth();
  const res = await fetch(`${server}/api/workflows/${id}/result`, {
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
  });
  const data = await res.json() as any;
  if (opts.json) { console.log(JSON.stringify(data, null, 2)); return; }
  if (res.status === 202) {
    console.log(`\n  ${pc.blue('⏳')} Still running: ${id}\n`);
  } else {
    console.log(`\n  ${pc.green('✓')} Result for ${pc.dim(id)}:`);
    console.log(JSON.stringify(data.result?.data ?? data.result ?? data, null, 2));
    console.log();
  }
}

export async function terminateWorkflow(id: string): Promise<void> {
  await apiFetch(`/workflows/terminate/${id}`, { method: 'POST' });
  console.log(`\n  ${pc.green('✓')} Terminated ${pc.dim(id)}\n`);
}
