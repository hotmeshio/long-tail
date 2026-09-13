import { validateResolverPayload } from '../../shared/form-validation/validate-resolver-payload';
import { buildInvokeFormContext } from '../../shared/form-validation/invoke-context';
import { LT_ERROR_CODES, type LTValidationErrorBody } from '../../types/validation';
import type { LTWorkflowConfig } from '../../types/config';
import type { LTApiResult } from '../../types/sdk';

/**
 * The invoke input gate. A workflow that declares input_schema has its
 * submitted data validated by the same shared pass the dashboard form runs,
 * so a payload the form accepts is accepted here and a rejection lists the
 * exact violations the form would show. No schema, no gate.
 */
export function checkInvokeInput(
  config: Pick<LTWorkflowConfig, 'workflow_type' | 'input_schema'> | null | undefined,
  data: Record<string, unknown>,
  metadata: Record<string, unknown> | null | undefined,
): LTValidationErrorBody | null {
  const schema = config?.input_schema;
  if (!schema) return null;
  const violations = validateResolverPayload(schema, data, buildInvokeFormContext(metadata));
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
