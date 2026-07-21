/**
 * Transport-agnostic API result envelope.
 *
 * Every API-layer function returns this shape. The `status` field
 * carries an HTTP-equivalent status code (200, 400, 403, 404, 409, 500)
 * so callers retain the same semantics regardless of transport.
 *
 * Express routes map `status` → `res.status()` and `data`/`error` → JSON body.
 * SDK callers inspect the envelope directly.
 */
export interface LTApiResult<T = any> {
  /** HTTP-equivalent status code */
  status: number;
  /** Success payload (present when status is 2xx). On structured errors (e.g.
   *  422 schema validation) it carries the canonical error body so routes
   *  serialize the full shape and SDK callers read it without re-fetching. */
  data?: T;
  /** Error message (present when status is 4xx/5xx) */
  error?: string;
  /** Machine-readable error code (types/validation.ts LT_ERROR_CODES) for
   *  errors callers are expected to branch on, e.g. 'schema_validation'. */
  code?: string;
}

/**
 * Auth context passed to API-layer functions.
 *
 * In HTTP mode this is derived from `req.auth` (JWT / bot key).
 * In SDK mode the caller supplies it via `createClient({ auth })`.
 */
export interface LTApiAuth {
  userId: string;
  role?: string;
  scopes?: string[];
}
