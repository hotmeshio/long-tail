import { apiFetch } from '../client';
import { output } from '../format';

const COLUMNS = [
  { key: 'key', label: 'Key', width: 20 },
  { key: 'title', label: 'Title', width: 24 },
  {
    key: 'roles', label: 'Roles', width: 8,
    format: (v: { role: string }[]) => String(Array.isArray(v) ? v.length : 0),
  },
  { key: 'user_count', label: 'Users', width: 6, format: (v: number) => String(v ?? 0) },
  { key: 'description', label: 'Description', width: 40 },
];

export async function listPersonas(opts: { json?: boolean; quiet?: boolean }): Promise<void> {
  const data = await apiFetch<any>('/personas');
  output(data, data.personas || [], COLUMNS, opts, 'key');
}

export async function getPersona(key: string, opts: { json?: boolean }): Promise<void> {
  const data = await apiFetch<any>(`/personas/${encodeURIComponent(key)}`);
  console.log(JSON.stringify(data, null, 2));
}

export async function assignPersona(key: string, userId: string, opts: { json?: boolean }): Promise<void> {
  const data = await apiFetch<any>(`/users/${encodeURIComponent(userId)}/personas`, {
    method: 'POST',
    body: JSON.stringify({ persona: key }),
  });
  console.log(JSON.stringify(data, null, 2));
}

export async function unassignPersona(key: string, userId: string, opts: { json?: boolean }): Promise<void> {
  const data = await apiFetch<any>(
    `/users/${encodeURIComponent(userId)}/personas/${encodeURIComponent(key)}`,
    { method: 'DELETE' },
  );
  console.log(JSON.stringify(data, null, 2));
}

export async function getUserPersonas(userId: string, opts: { json?: boolean }): Promise<void> {
  const data = await apiFetch<any>(`/users/${encodeURIComponent(userId)}/personas`);
  console.log(JSON.stringify(data, null, 2));
}
