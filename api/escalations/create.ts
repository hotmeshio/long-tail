import Ajv, { type ValidateFunction } from 'ajv';
import * as escalationService from '../../services/escalation';
import * as roleService from '../../services/role';
import { assertQueueManageAccess } from './helpers';
import type { LTApiResult, LTApiAuth } from '../../types/sdk';

// strict: false — role metadata_schemas use the project's house extension
// keywords (x-lt-widget etc., the same style as seeded form_schemas); Ajv 8's
// strict mode throws at compile on any unknown keyword, which would turn every
// metadata-bearing create for that role into a 500.
const ajv = new Ajv({ allErrors: true, strict: false });

// Compiled validators cached per role, keyed by the schema's serialized form
// so an admin's schema edit invalidates the stale validator on the next create.
const validatorCache = new Map<string, { key: string; validate: ValidateFunction }>();

function compileRoleValidator(role: string, schema: Record<string, any>): ValidateFunction {
  const key = JSON.stringify(schema);
  const cached = validatorCache.get(role);
  if (cached && cached.key === key) return cached.validate;
  const validate = ajv.compile(schema);
  validatorCache.set(role, { key, validate });
  return validate;
}

// ── Create ────────────────────────────────────────────────────────────────

/**
 * Create a standalone escalation (not tied to a workflow).
 *
 * Useful for manual work items, support tickets, or approval requests
 * that originate outside the durable workflow engine. The caller must
 * hold the target role or be a superadmin.
 *
 * @param input.type — escalation category (e.g. `"support"`, `"approval"`)
 * @param input.subtype — subcategory for finer routing
 * @param input.role — role responsible for resolving this escalation
 * @param input.description — human-readable summary
 * @param input.priority — 1 (critical) through 4 (low), default 2
 * @param input.envelope — serialized context for the resolver
 * @param input.metadata — arbitrary key-value data (e.g. signal_routing)
 * @param input.escalation_payload — serialized payload for the resolver UI
 * @param auth — authenticated user context (must hold target role or be superadmin)
 * @returns `{ status: 201, data: <escalation record> }`
 */
export async function createEscalation(
  input: {
    type: string;
    subtype?: string;
    role: string;
    description?: string;
    priority?: number;
    envelope?: string;
    metadata?: Record<string, any>;
    escalation_payload?: string;
    // Workflow-linkage (optional): set when the escalation is an advert for a running
    // workflow — e.g. an order enqueuing demand units for the broker to claim.
    origin_id?: string;
    parent_id?: string;
    task_id?: string;
    workflow_id?: string;
    task_queue?: string;
    workflow_type?: string;
  },
  auth: LTApiAuth,
): Promise<LTApiResult> {
  try {
    const { type, role } = input;
    if (!type || typeof type !== 'string') {
      return { status: 400, error: 'type is required' };
    }
    if (!role || typeof role !== 'string') {
      return { status: 400, error: 'role is required' };
    }

    // RBAC: creating an escalation injects work into a role's queue — a write_all
    // (or global) action. read-only and self-scope members may not create.
    const denied = await assertQueueManageAccess(auth.userId, role);
    if (denied) {
      return { status: 403, error: `You must have write access to the "${role}" role or be a superadmin to create escalations for it` };
    }

    // Validate metadata against the role's declared schema (if any).
    if (input.metadata) {
      const schema = await roleService.getRoleMetadataSchema(role);
      if (schema) {
        let validate: ValidateFunction;
        try {
          validate = compileRoleValidator(role, schema);
        } catch (compileErr: any) {
          // A broken stored schema is the role admin's bug, not the creator's —
          // name it explicitly instead of surfacing an opaque 500.
          return {
            status: 422,
            error: `metadata_schema for role "${role}" is not a valid JSON Schema: ${compileErr.message}`,
          };
        }
        const valid = validate(input.metadata);
        if (!valid) {
          const msgs = (validate.errors ?? []).map((e) => `${e.instancePath || '(root)'} ${e.message}`).join('; ');
          return { status: 400, error: `metadata does not match the role schema: ${msgs}` };
        }
      }
    }

    const escalation = await escalationService.createEscalation({
      type,
      subtype: input.subtype ?? type,
      description: input.description,
      priority: input.priority,
      role,
      envelope: input.envelope ?? '{}',
      metadata: input.metadata,
      escalation_payload: input.escalation_payload,
      origin_id: input.origin_id,
      parent_id: input.parent_id,
      task_id: input.task_id,
      workflow_id: input.workflow_id,
      task_queue: input.task_queue,
      workflow_type: input.workflow_type,
    });

    // Event published by service layer (services/escalation/crud.ts)

    return { status: 201, data: escalation };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}
