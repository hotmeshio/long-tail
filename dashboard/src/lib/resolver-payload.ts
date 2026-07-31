import { mapFormToPayload } from './x-lt-bind';
import { validateResolverForm, type FieldError } from './field-validator';
import type { ShowIfContext } from './x-lt-show-if';

export interface ResolverPayloadResult {
  /** The resolver payload ready to submit — null when the JSON is unparseable or validation failed. */
  payload: Record<string, unknown> | null;
  /** Field errors against the embedded _form_schema (empty when the form is valid). */
  errors: FieldError[];
  /** Set when the edited JSON string itself is malformed. */
  parseError: string | null;
}

/**
 * Build the resolver payload from the form's edited JSON string.
 *
 * 1. Parse the JSON — a malformed string yields `parseError`.
 * 2. Validate every visible field against the embedded `_form_schema` — hidden
 *    fields (x-lt-showIf falsy against the live context) are skipped, matching
 *    the server's enforcement pass. Any failures yield `errors`.
 * 3. Strip the UI-only schema and map flat form fields into their nested shape
 *    via x-lt-bind — the payload IS the payload.
 *
 * The single path shared by the footer's Submit button and the submit-on-claim
 * shortcut, so both produce identical payloads and identical error lists.
 */
export function buildResolverPayload(
  json: string,
  context?: ShowIfContext,
): ResolverPayloadResult {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(json) as Record<string, unknown>;
  } catch {
    return { payload: null, errors: [], parseError: 'Invalid JSON' };
  }

  const schema = parsed._form_schema as Record<string, unknown> | undefined;
  if (schema) {
    const errors = validateResolverForm(schema, parsed, context);
    if (errors.length > 0) return { payload: null, errors, parseError: null };
  }

  const { _form_schema, ...formValues } = parsed;
  return {
    payload: mapFormToPayload(formValues, schema as Record<string, any> | undefined),
    errors: [],
    parseError: null,
  };
}
