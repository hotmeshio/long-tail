import { resolveAuth } from './auth';

export class CLIError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
    this.name = 'CLIError';
  }
}

/** Authenticated fetch against the Long Tail API */
export async function apiFetch<T = any>(
  path: string,
  options?: RequestInit,
): Promise<T> {
  const { server, token } = await resolveAuth();
  const url = `${server}/api${path}`;

  const res = await fetch(url, {
    ...options,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });

  const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));

  if (!res.ok) {
    throw new CLIError(body.error || `HTTP ${res.status}`, res.status);
  }

  return body as T;
}
