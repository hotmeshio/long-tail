import pc from 'picocolors';
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

/** Parse a repeatable `key=value` flag; values JSON-parse with string fallback. */
function parsePairs(pairs: string[] | undefined): Record<string, unknown> | undefined {
  if (!pairs?.length) return undefined;
  const out: Record<string, unknown> = {};
  for (const pair of pairs) {
    const eq = pair.indexOf('=');
    if (eq <= 0) throw new Error(`Expected key=value, got "${pair}"`);
    const key = pair.slice(0, eq);
    const raw = pair.slice(eq + 1);
    try { out[key] = JSON.parse(raw); } catch { out[key] = raw; }
  }
  return out;
}

/**
 * View or atomically patch a user's properties dictionary. With no flags,
 * prints the dictionary; with --set/--remove/--rename, applies ONE atomic
 * patch (never read-merge-write) and prints the result.
 */
export async function userProps(
  id: string,
  opts: { set?: string[]; remove?: string[]; rename?: string[]; json?: boolean },
): Promise<void> {
  const set = parsePairs(opts.set);
  const rename = parsePairs(opts.rename) as Record<string, string> | undefined;
  const remove = opts.remove?.length ? opts.remove : undefined;

  let user: any;
  if (set || remove || rename) {
    user = await apiFetch<any>(`/users/${id}/properties`, {
      method: 'PATCH',
      body: JSON.stringify({ set, remove, rename }),
    });
  } else {
    user = await apiFetch<any>(`/users/${id}`);
  }

  if (opts.json) { console.log(JSON.stringify(user.metadata ?? {}, null, 2)); return; }
  const props = Object.entries(user.metadata ?? {});
  console.log(`\n  ${pc.bold(user.display_name ?? user.external_id ?? id)} ${pc.dim(user.id ?? id)}`);
  if (props.length === 0) {
    console.log(pc.dim('  (no properties)\n'));
    return;
  }
  for (const [key, value] of props) {
    console.log(`  ${pc.bold(key)} = ${typeof value === 'string' ? value : JSON.stringify(value)}`);
  }
  console.log();
}
