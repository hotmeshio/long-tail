import pc from 'picocolors';
import { apiFetch } from '../client';
import { output, formatTime } from '../format';

const DOMAIN_COLUMNS = [
  { key: 'domain', label: 'Domain', width: 24 },
  { key: 'count', label: 'Entries', width: 8, align: 'right' as const },
  { key: 'latest', label: 'Latest', width: 12, format: formatTime },
];

const ENTRY_COLUMNS = [
  { key: 'key', label: 'Key', width: 24 },
  { key: '_fieldCount', label: 'Fields', width: 8, align: 'right' as const },
  { key: 'tags', label: 'Tags', width: 20, format: (v: string[]) => (v || []).join(', ') },
  { key: 'updated_at', label: 'Updated', width: 12, format: formatTime },
];

export async function listDomains(opts: { json?: boolean; quiet?: boolean }): Promise<void> {
  const data = await apiFetch<any>('/knowledge/domains');
  output(data, data.domains || [], DOMAIN_COLUMNS, opts, 'domain');
}

export async function listEntries(domain: string, opts: { search?: string; limit?: string; json?: boolean; quiet?: boolean }): Promise<void> {
  const params = new URLSearchParams({ domain });
  if (opts.search) params.set('search', opts.search);
  if (opts.limit) params.set('limit', opts.limit);
  const data = await apiFetch<any>(`/knowledge/entries?${params}`);
  const entries = (data.entries || []).map((e: any) => ({
    ...e,
    _fieldCount: e.data ? Object.keys(e.data).length : 0,
  }));
  output(data, entries, ENTRY_COLUMNS, opts, 'key');
}

export async function getEntry(domain: string, key: string, opts: { json?: boolean }): Promise<void> {
  const params = new URLSearchParams({ domain, key });
  const data = await apiFetch<any>(`/knowledge/entry?${params}`);
  if (opts.json) { console.log(JSON.stringify(data, null, 2)); return; }
  if (data.found === false) {
    console.log(pc.yellow(`\n  Not found: ${domain}/${key}\n`));
    return;
  }
  console.log(`\n  ${pc.bold(`${domain}/${key}`)} ${pc.dim(data.id)}`);
  if (data.tags?.length) console.log(`  Tags: ${data.tags.join(', ')}`);
  console.log(`  Updated: ${formatTime(data.updated_at)}\n`);
  console.log(JSON.stringify(data.data, null, 2));
  console.log();
}

export async function setField(domain: string, key: string, path: string, value: string, opts: { json?: boolean }): Promise<void> {
  // Try to parse as JSON, fall back to string
  let parsed: any = value;
  try { parsed = JSON.parse(value); } catch { /* keep as string */ }
  const data = await apiFetch<any>('/knowledge/field', {
    method: 'PUT',
    body: JSON.stringify({ domain, key, path, value: parsed }),
  });
  if (opts.json) { console.log(JSON.stringify(data, null, 2)); return; }
  console.log(`\n  ${pc.green('✓')} Set ${pc.bold(`${domain}/${key}`)} → ${path}\n`);
}

export async function removeField(domain: string, key: string, path: string): Promise<void> {
  const params = new URLSearchParams({ domain, key, path });
  await apiFetch(`/knowledge/field?${params}`, { method: 'DELETE' });
  console.log(`\n  ${pc.green('✓')} Removed ${path} from ${pc.bold(`${domain}/${key}`)}\n`);
}

export async function deleteEntry(domain: string, key: string): Promise<void> {
  const params = new URLSearchParams({ domain, key });
  await apiFetch(`/knowledge/entry?${params}`, { method: 'DELETE' });
  console.log(`\n  ${pc.green('✓')} Deleted ${pc.bold(`${domain}/${key}`)}\n`);
}
