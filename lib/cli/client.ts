import { resolveAuth } from './auth';
import { isValidationErrorBody, type LTFieldViolation } from '../../types/validation';

export class CLIError extends Error {
  /** Field-level violations from a schema_validation 422, when present. */
  public violations?: LTFieldViolation[];

  constructor(message: string, public status?: number, violations?: LTFieldViolation[]) {
    super(message);
    this.name = 'CLIError';
    this.violations = violations;
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
    throw new CLIError(
      body.error || `HTTP ${res.status}`,
      res.status,
      isValidationErrorBody(body) ? body.violations : undefined,
    );
  }

  return body as T;
}
