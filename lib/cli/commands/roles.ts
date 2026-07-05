import * as fs from 'fs';
import pc from 'picocolors';
import { apiFetch } from '../client';
import { output, formatTime } from '../format';

const ROLE_COLUMNS = [
  { key: 'role', label: 'Role', width: 20 },
  { key: 'title', label: 'Title', width: 24 },
  { key: 'current_schema_version', label: 'Schema v', width: 8, align: 'right' as const },
  { key: 'user_count', label: 'Users', width: 6, align: 'right' as const },
  { key: 'workflow_count', label: 'Workflows', width: 9, align: 'right' as const },
];

const VERSION_COLUMNS = [
  { key: 'version', label: 'Version', width: 8, align: 'right' as const },
  { key: 'is_current', label: 'Current', width: 8, format: (v: boolean) => (v ? '●' : '') },
  { key: 'change_summary', label: 'Summary', width: 40 },
  { key: 'created_at', label: 'Created', width: 12, format: formatTime },
];

export async function listRoles(opts: { json?: boolean; quiet?: boolean }): Promise<void> {
  const data = await apiFetch<any>('/roles/details');
  output(data, data.roles || [], ROLE_COLUMNS, opts, 'role');
}

export async function getRoleSchema(
  role: string,
  opts: { version?: string; json?: boolean },
): Promise<void> {
  const params = new URLSearchParams();
  if (opts.version) params.set('version', opts.version);
  const qs = params.toString();
  const data = await apiFetch<any>(`/roles/${encodeURIComponent(role)}/schema${qs ? `?${qs}` : ''}`);
  if (opts.json) { console.log(JSON.stringify(data, null, 2)); return; }
  const versionLabel = data.version != null ? `v${data.version}` : 'unversioned';
  const pinNote = opts.version ? ' (pinned)' : ` (latest: v${data.latest_version ?? '—'})`;
  console.log(`\n  ${pc.bold(role)} schema ${versionLabel}${pinNote}`);
  if (data.change_summary) console.log(`  ${data.change_summary}`);
  console.log(`\n  ${pc.bold('form_schema')}\n${JSON.stringify(data.form_schema, null, 2)}`);
  console.log(`\n  ${pc.bold('metadata_schema')}\n${JSON.stringify(data.metadata_schema, null, 2)}`);
  console.log();
}

export async function listRoleSchemaVersions(
  role: string,
  opts: { json?: boolean; quiet?: boolean },
): Promise<void> {
  const data = await apiFetch<any>(`/roles/${encodeURIComponent(role)}/schema/versions`);
  output(data, data.versions || [], VERSION_COLUMNS, opts, 'version');
}

export async function saveRoleSchema(
  role: string,
  opts: { file?: string; summary?: string; json?: boolean },
): Promise<void> {
  // One PATCH carrying only the schema (and its summary) — a schema change
  // appends the next immutable version; an identical save leaves it alone.
  const raw = opts.file ? fs.readFileSync(opts.file, 'utf8') : fs.readFileSync(0, 'utf8');
  const schema = JSON.parse(raw);
  const data = await apiFetch<any>(`/roles/${encodeURIComponent(role)}`, {
    method: 'PATCH',
    body: JSON.stringify({ form_schema: schema, change_summary: opts.summary }),
  });
  if (opts.json) { console.log(JSON.stringify(data, null, 2)); return; }
  const version = data.current_schema_version != null ? ` — v${data.current_schema_version} in use` : '';
  console.log(`\n  ${pc.green('✓')} Saved ${role} escalation schema${version}\n`);
}
