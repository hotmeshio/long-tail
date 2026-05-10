import { apiFetch } from '../client';
import { output } from '../format';

const SERVER_COLUMNS = [
  { key: 'id', label: 'ID', width: 12, format: (v: string) => v?.slice(0, 12) || '' },
  { key: 'name', label: 'Name', width: 28 },
  { key: 'transport_type', label: 'Transport', width: 10 },
  { key: 'status', label: 'Status', width: 10 },
];

export async function listServers(opts: { json?: boolean; quiet?: boolean }): Promise<void> {
  const data = await apiFetch<any>('/mcp/servers');
  const servers = data.servers || data;
  output(data, Array.isArray(servers) ? servers : [], SERVER_COLUMNS, opts);
}

export async function listTools(serverId: string, opts: { json?: boolean; quiet?: boolean }): Promise<void> {
  const data = await apiFetch<any>(`/mcp/servers/${serverId}/tools`);
  const tools = data.tools || [];
  if (opts.json) { console.log(JSON.stringify(data, null, 2)); return; }
  if (opts.quiet) { tools.forEach((t: any) => console.log(t.name)); return; }
  output(data, tools, [
    { key: 'name', label: 'Tool', width: 30 },
    { key: 'description', label: 'Description', width: 50 },
  ], {});
}
