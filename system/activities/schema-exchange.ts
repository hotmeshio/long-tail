/**
 * Schema-driven data exchange with external service endpoints.
 *
 * Three pillars: endpoint + schema + identity.
 * Transport (fetch, Playwright, gRPC) is an implementation detail.
 * The value is schema enforcement and credential resolution —
 * validating both sides of the exchange and resolving auth from
 * the connection store at the last mile.
 */

import Ajv from 'ajv';

import { getToolContext } from '../../services/iam/context';
import { resolveCredential } from '../../services/iam/credentials';

const DEFAULT_TIMEOUT = parseInt(process.env.LT_SCHEMA_EXCHANGE_TIMEOUT_MS || '30000', 10);

const ajv = new Ajv({ allErrors: true, strict: false });

/**
 * Normalize a JSON Schema object before validation.
 *
 * HotMesh YAML maps serialize JSON arrays as indexed objects
 * (e.g. `required: {"0":"username","1":"password"}` instead of
 * `required: ["username","password"]`). This recursively converts
 * any indexed-object `required` fields back to arrays so Ajv
 * validates correctly.
 */
function normalizeSchema(obj: unknown): unknown {
  if (obj === null || obj === undefined || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(normalizeSchema);

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (key === 'required' && value && typeof value === 'object' && !Array.isArray(value)) {
      // Convert indexed object {"0":"a","1":"b"} to array ["a","b"]
      const keys = Object.keys(value as Record<string, unknown>);
      if (keys.every(k => /^\d+$/.test(k))) {
        result[key] = keys.sort((a, b) => Number(a) - Number(b)).map(k => (value as Record<string, unknown>)[k]);
        continue;
      }
    }
    result[key] = normalizeSchema(value);
  }
  return result;
}

/**
 * Validate data against a JSON Schema.
 *
 * Returns a list of human-readable error strings (empty when valid).
 */
export function validateSchema(
  data: unknown,
  schema: Record<string, unknown>,
): { valid: boolean; errors: string[] } {
  const normalized = normalizeSchema(schema) as Record<string, unknown>;
  const validate = ajv.compile(normalized);
  const valid = validate(data) as boolean;
  if (valid) return { valid: true, errors: [] };

  const errors = (validate.errors || []).map((e) => {
    const path = e.instancePath || '(root)';
    return `${path}: ${e.message}${e.params ? ` (${JSON.stringify(e.params)})` : ''}`;
  });
  return { valid: false, errors };
}

/**
 * Exchange data with an external service endpoint under schema enforcement.
 *
 * 1. If request_schema provided, validate body before sending.
 *    On failure: return immediately (never send the request).
 * 2. Make the HTTP call (transport layer — currently Node.js fetch).
 * 3. Parse response body (JSON auto-detect).
 * 4. If response_schema provided, validate response after receiving.
 * 5. Return result with validated flag and any validation_errors.
 */
export async function exchange(args: {
  endpoint?: string;
  url?: string;
  method: string;
  headers?: Record<string, string>;
  query?: Record<string, string>;
  body?: unknown;
  request_schema?: Record<string, unknown>;
  response_schema?: Record<string, unknown>;
  timeout_ms?: number;
  credential_provider?: string;
  credential_label?: string;
  auth_scheme?: string;
  auth_header?: string;
}): Promise<{
  status: number;
  data: unknown;
  headers: Record<string, string>;
  elapsed_ms: number;
  validated: boolean;
  validation_errors: string[];
}> {
  // 1. Validate request body against schema (if provided)
  if (args.request_schema && args.body !== undefined) {
    const result = validateSchema(args.body, args.request_schema);
    if (!result.valid) {
      return {
        status: 0,
        data: null,
        headers: {},
        elapsed_ms: 0,
        validated: false,
        validation_errors: result.errors.map((e) => `request: ${e}`),
      };
    }
  }

  // 2. Resolve credential from connection store (if credential_provider set)
  if (args.credential_provider) {
    const ctx = getToolContext();
    if (!ctx?.principal) {
      return {
        status: 0, data: null, headers: {}, elapsed_ms: 0,
        validated: false,
        validation_errors: ['credential: no identity context — cannot resolve credential_provider without a principal'],
      };
    }
    const cred = await resolveCredential(
      ctx.principal,
      args.credential_provider,
      args.credential_label,
      ctx.initiatingPrincipal ? { fallbackPrincipal: ctx.initiatingPrincipal } : undefined,
    );
    if (!cred) {
      return {
        status: 0, data: null, headers: {}, elapsed_ms: 0,
        validated: false,
        validation_errors: [`credential: no credential found for provider "${args.credential_provider}" — register one at Settings > Connections`],
      };
    }
    const scheme = args.auth_scheme || 'Bearer';
    const headerName = args.auth_header || 'Authorization';
    args.headers = { ...args.headers, [headerName]: `${scheme} ${cred.value}` };
  }

  // 3. Build URL with query parameters (accept endpoint or url)
  let url = args.endpoint || args.url;
  if (!url) {
    return {
      status: 0, data: null, headers: {}, elapsed_ms: 0,
      validated: false, validation_errors: ['endpoint or url is required'],
    };
  }
  if (args.query && Object.keys(args.query).length > 0) {
    const params = new URLSearchParams(args.query);
    url += (url.includes('?') ? '&' : '?') + params.toString();
  }

  // 3. Make the HTTP call
  const start = performance.now();
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    args.timeout_ms || DEFAULT_TIMEOUT,
  );

  let status: number;
  let responseHeaders: Record<string, string> = {};
  let rawBody: string;

  try {
    const fetchOpts: RequestInit = {
      method: args.method,
      headers: args.headers,
      signal: controller.signal,
    };

    if (args.body !== undefined && args.method !== 'GET' && args.method !== 'HEAD') {
      fetchOpts.body = typeof args.body === 'string' ? args.body : JSON.stringify(args.body);
      if (!args.headers?.['Content-Type'] && !args.headers?.['content-type']) {
        fetchOpts.headers = { ...fetchOpts.headers, 'Content-Type': 'application/json' } as Record<string, string>;
      }
    }

    const response = await fetch(url, fetchOpts);
    status = response.status;
    response.headers.forEach((value, key) => { responseHeaders[key] = value; });
    rawBody = await response.text();
  } catch (err: any) {
    const elapsed = performance.now() - start;
    return {
      status: 0,
      data: null,
      headers: {},
      elapsed_ms: Math.round(elapsed),
      validated: false,
      validation_errors: [`transport: ${err.name === 'AbortError' ? 'request timed out' : err.message}`],
    };
  } finally {
    clearTimeout(timeout);
  }

  const elapsed = performance.now() - start;

  // 3b. Fail fast on auth errors — don't silently return a 401 as a "result"
  if (status === 401 || status === 403) {
    return {
      status,
      data: null,
      headers: responseHeaders,
      elapsed_ms: Math.round(elapsed),
      validated: false,
      validation_errors: [
        status === 401
          ? 'authentication: token expired or invalid — refresh credentials and retry'
          : 'authorization: insufficient permissions for this endpoint',
      ],
    };
  }

  // 4. Parse response body
  let data: unknown;
  const contentType = responseHeaders['content-type'] || '';
  if (contentType.includes('json') || (rawBody.startsWith('{') || rawBody.startsWith('['))) {
    try {
      data = JSON.parse(rawBody);
    } catch {
      data = rawBody;
    }
  } else {
    data = rawBody;
  }

  // 5. Validate response against schema (if provided)
  let validated = true;
  let validationErrors: string[] = [];

  if (args.response_schema) {
    const result = validateSchema(data, args.response_schema);
    validated = result.valid;
    validationErrors = result.errors.map((e) => `response: ${e}`);
  }

  return {
    status,
    data,
    headers: responseHeaders,
    elapsed_ms: Math.round(elapsed),
    validated,
    validation_errors: validationErrors,
  };
}
