import { apiFetch } from '../client';
import { output } from '../format';

const COLUMNS = [
  { key: 'id', label: 'ID', width: 12, format: (v: string) => v?.slice(0, 12) || '' },
  { key: 'external_id', label: 'Username', width: 20 },
  { key: 'display_name', label: 'Name', width: 20 },
  { key: 'status', label: 'Status', width: 10 },
];

export async function listUsers(opts: { json?: boolean; quiet?: boolean }): Promise<void> {
  const data = await apiFetch<any>('/users');
  const users = data.users || data;
  output(data, Array.isArray(users) ? users : [], COLUMNS, opts);
}

export async function getUser(id: string, opts: { json?: boolean }): Promise<void> {
  const data = await apiFetch<any>(`/users/${id}`);
  if (opts.json) { console.log(JSON.stringify(data, null, 2)); return; }
  console.log(JSON.stringify(data, null, 2));
}
