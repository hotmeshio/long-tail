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
 * Root-level x-lt-require-any groups run after the per-field pass: each group
 * needs a value in at least one visible member (all-hidden groups are waived).
 *
 * The showIf/`resolver.*` domain is always the FLAT form representation, so a
 * condition like `resolver.approved` reads the same on both sides.
 */
import { type FieldError, validateField } from './field-validator';
import { evaluateShowIf, type ShowIfContext } from './x-lt-show-if';
import { mapPayloadToForm } from './x-lt-bind';
import { readRequireAnyGroups, hasRequireAnyValue } from './x-lt-require-any';

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

  // Require-any groups: at least one VISIBLE member per group carries a value.
  // A member hidden by showIf (or naming no property) can neither satisfy nor
  // be demanded; an all-hidden group is waived.
  for (const group of readRequireAnyGroups(schema)) {
    const visible = group.filter(
      (k) => properties[k] && evaluateShowIf(properties[k]['x-lt-showIf'], liveCtx),
    );
    if (visible.length === 0) continue;
    if (visible.some((k) => hasRequireAnyValue(formValues[k]))) continue;
    const titles = visible.map((k) => (properties[k].title as string | undefined) ?? k);
    errors.push({
      field: visible[0],
      message: `Enter a value for at least one of: ${titles.join(', ')}`,
    });
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
