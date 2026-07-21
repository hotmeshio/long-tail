/**
 * The full pre-submission validation pass over a resolver form schema — the
 * same pass on both sides of the wire. The dashboard runs it on the flat form
 * values before submitting; the API layer runs it on the submitted (bound,
 * nested) payload by inverting x-lt-bind first. Because both entry points
 * funnel into one loop, a payload that passes the client panel passes the
 * server gate, and a 422's violation list is exactly what the panel shows.
 *
 * Semantics per field:
 *   - x-lt-showIf-hidden fields are skipped entirely (a field the submitter
 *     cannot see never blocks submission)
 *   - required (schema.required membership), with checklist/empty-object rules
 *   - declared-type check (string/number/integer/boolean/array/object)
 *   - enum membership
 *   - x-lt-require-all against the checklist items resolved from context
 *   - static + dynamic bounds (minimum/x-lt-minimum, lengths, patterns)
 *
 * The showIf/`resolver.*` domain is always the FLAT form representation, so a
 * condition like `resolver.approved` reads the same on both sides.
 */
import { type FieldError, validateField } from './field-validator';
import { evaluateShowIf, type ShowIfContext } from './x-lt-show-if';
import { mapPayloadToForm } from './x-lt-bind';

export type { FieldError } from './field-validator';

/**
 * The escalation-surface context the pass evaluates showIf conditions and
 * dynamic constraints against. `resolver` is supplied by the pass itself
 * (the flat form values under validation) — callers provide the rest.
 */
export type ResolverValidationContext = Omit<ShowIfContext, 'resolver'>;

/**
 * Validate FLAT form values against the form schema. This is the dashboard's
 * entry point (the values the user edits, keyed by field name).
 */
export function validateResolverForm(
  schema: Record<string, unknown> | null | undefined,
  formValues: Record<string, unknown>,
  ctx?: ResolverValidationContext | null,
): FieldError[] {
  if (!schema) return [];
  const properties = (schema.properties ?? {}) as Record<string, Record<string, unknown>>;
  const required = new Set((schema.required as string[] | undefined) ?? []);
  const liveCtx: ShowIfContext = {
    ...(ctx ?? {}),
    resolver: formValues as Record<string, unknown>,
  };

  const errors: FieldError[] = [];
  for (const [field, fieldSchema] of Object.entries(properties)) {
    if (!evaluateShowIf(fieldSchema['x-lt-showIf'], liveCtx)) continue;
    const err = validateField(
      formValues[field],
      fieldSchema,
      required.has(field),
      true,
      liveCtx as Record<string, unknown>,
    );
    if (err) errors.push({ field, message: err });
  }
  return errors;
}

/**
 * Validate a SUBMITTED resolver payload (the bound, nested shape the workflow
 * consumes) against the form schema. This is the API layer's entry point: the
 * payload is inverted through each field's x-lt-bind path back to the flat
 * form representation, then run through the same pass the client uses.
 */
export function validateResolverPayload(
  schema: Record<string, unknown> | null | undefined,
  payload: Record<string, unknown>,
  ctx?: ResolverValidationContext | null,
): FieldError[] {
  if (!schema) return [];
  const formValues = mapPayloadToForm(payload, schema as Record<string, any>);
  return validateResolverForm(schema, formValues, ctx);
}
