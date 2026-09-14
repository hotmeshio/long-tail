import { validateResolverPayload } from '../../shared/form-validation/validate-resolver-payload';
import { buildInvokeFormContext } from '../../shared/form-validation/invoke-context';
import { resolveLookupContext } from '../../services/knowledge/lookup-cache';
import { LT_ERROR_CODES, type LTValidationErrorBody } from '../../types/validation';
import type { LTWorkflowConfig } from '../../types/config';
import type { LTApiResult } from '../../types/sdk';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}


/**
 * The invoke input gate. A workflow that declares input_schema has its
 * submitted data validated by the same shared pass the dashboard form runs,
 * so a payload the form accepts is accepted here and a rejection lists the
 * exact violations the form would show. Pinned input_lookups resolve into
 * the `lookup` domain first. No schema, no gate; a data value that is not
 * an object is left to the service's own 400.
 */
export async function checkInvokeInput(
  config: Pick<LTWorkflowConfig, 'workflow_type' | 'input_schema' | 'input_lookups'> | null | undefined,
  data: unknown,
  metadata: Record<string, unknown> | null | undefined,
): Promise<LTValidationErrorBody | null> {
  const schema = config?.input_schema;
  if (!schema || !isPlainObject(data)) return null;
  const lookup = await resolveLookupContext(config?.input_lookups);
  const violations = validateResolverPayload(schema, data, buildInvokeFormContext(metadata, lookup));
  if (violations.length === 0) return null;
  const n = violations.length;
  return {
    error: `data failed input schema validation (${n} violation${n === 1 ? '' : 's'})`,
    code: LT_ERROR_CODES.SCHEMA_VALIDATION,
    violations,
    role: null,
    schemaVersion: null,
    workflowType: config!.workflow_type,
  };
}

/** The canonical 422 result; the route serializes `data` as the body. */
export function inputValidationFailure(body: LTValidationErrorBody): LTApiResult {
  return { status: 422, error: body.error, code: body.code, data: body };
}
