/**
 * Canonical validation-error shapes — one vocabulary across every surface.
 *
 * When server-side resolver schema enforcement rejects a payload, the API
 * layer returns status 422 with `LTValidationErrorBody` as the response body.
 * The same body shape flows to every consumer:
 *   - HTTP routes serialize it as the JSON response body
 *   - SDK callers receive it as `result.data` (with `result.code` set)
 *   - MCP resolve tools return it as the tool's JSON error content
 *   - the CLI prints the violation list beneath the error line
 *   - the dashboard maps `violations` into the same errors panel the
 *     pre-submission pass feeds
 */

/** Machine-readable error codes carried on error envelopes and bodies. */
export const LT_ERROR_CODES = {
  /** The resolver payload failed the role's enforced form schema. */
  SCHEMA_VALIDATION: 'schema_validation',
} as const;

export type LTErrorCode = (typeof LT_ERROR_CODES)[keyof typeof LT_ERROR_CODES];

/**
 * One field-level violation — the same `{ field, message }` pair the dashboard
 * validation panel renders. Bulk surfaces add `escalationId` so a violation is
 * attributable to the row that produced it.
 */
export interface LTFieldViolation {
  field: string;
  message: string;
  escalationId?: string;
}

/** The 422 response body for a schema-validation rejection. */
export interface LTValidationErrorBody {
  /** Human-readable summary, e.g. "resolverPayload failed schema validation (2 violations)". */
  error: string;
  code: typeof LT_ERROR_CODES.SCHEMA_VALIDATION;
  /** Every field-level violation, in schema property order. */
  violations: LTFieldViolation[];
  /** The role whose enforced schema rejected the payload. */
  role: string;
  /** The schema version validated against; null when the role's live (unversioned) schema applied. */
  schemaVersion: number | null;
}

/** Narrow an unknown response body to the canonical validation-error shape. */
export function isValidationErrorBody(body: unknown): body is LTValidationErrorBody {
  return (
    typeof body === 'object' && body !== null
    && (body as Record<string, unknown>).code === LT_ERROR_CODES.SCHEMA_VALIDATION
    && Array.isArray((body as Record<string, unknown>).violations)
  );
}
