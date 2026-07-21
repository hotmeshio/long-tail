/**
 * Typed resolution parsing — the workflow-side half of the resolver contract.
 *
 * Server-side enforcement (enforce_schema roles) guarantees a resolution
 * matched the role's form schema when it was submitted. This module gives
 * workflow and activity code the consuming half: declare the payload shape
 * once as a zod schema, and parse the resolution through it to get a TYPED
 * value with runtime assurance — a drifted or legacy payload fails loud here
 * instead of propagating `any` into business logic.
 *
 *   const IntakeV1 = z.object({ customer: z.object({ name: z.string() }) });
 *   const intake = parseResolverPayload(IntakeV1, response);
 *   intake.customer.name; // typed AND runtime-checked
 */
import type { ZodType } from 'zod';

import type { LTFieldViolation } from '../types/validation';

/**
 * A resolution that failed its declared zod schema. Carries the same
 * `{ field, message }` violation list the validation surfaces use, and the
 * original ZodError as `cause`.
 */
export class ResolverPayloadTypeError extends Error {
  public violations: LTFieldViolation[];
  public cause?: unknown;

  constructor(violations: LTFieldViolation[], options?: { cause?: unknown }) {
    const n = violations.length;
    super(
      `resolver payload failed its declared schema (${n} violation${n === 1 ? '' : 's'}): `
      + violations.map((v) => `${v.field}: ${v.message}`).join('; '),
    );
    this.name = 'ResolverPayloadTypeError';
    this.violations = violations;
    this.cause = options?.cause;
  }
}

/**
 * Parse a resolution payload through its declared zod schema. Returns the
 * typed value; throws {@link ResolverPayloadTypeError} when the payload does
 * not conform. The generic flows from the schema to the return value — no
 * casting at the call site.
 */
export function parseResolverPayload<T>(schema: ZodType<T>, payload: unknown): T {
  const result = schema.safeParse(payload);
  if (!result.success) {
    const violations: LTFieldViolation[] = result.error.issues.map((issue) => ({
      field: issue.path.length > 0 ? issue.path.join('.') : '(root)',
      message: issue.message,
    }));
    throw new ResolverPayloadTypeError(violations, { cause: result.error });
  }
  return result.data;
}
