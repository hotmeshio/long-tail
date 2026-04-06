/**
 * Shared helpers for the end-to-end process runner.
 */

let _base = 'http://localhost:3000';

export function setBase(url: string) {
  _base = url;
}

export function getBase(): string {
  return _base;
}

export function log(role: string, msg: string) {
  const label = role.padEnd(10);
  console.log(`  ${label} │ ${msg}`);
}

export function header(text: string) {
  console.log(`\n  ─── ${text} ${'─'.repeat(Math.max(0, 58 - text.length))}\n`);
}

export async function api(
  method: string,
  path: string,
  token: string,
  body?: Record<string, any>,
): Promise<any> {
  const res = await fetch(`${_base}/api${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json();
  if (!res.ok) {
    throw new Error(`${method} ${path} → ${res.status}: ${JSON.stringify(json)}`);
  }
  return json;
}

export async function login(username: string, password: string): Promise<string> {
  const { token } = await api('POST', '/auth/login', '', { username, password });
  return token;
}

export async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function poll<T>(
  label: string,
  fn: () => Promise<T | null>,
  timeoutMs = 30_000,
  intervalMs = 1_000,
): Promise<T> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const result = await fn();
    if (result) return result;
    await sleep(intervalMs);
  }
  throw new Error(`Timed out waiting for: ${label}`);
}
