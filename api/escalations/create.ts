import { type ValidateFunction } from 'ajv';
import * as escalationService from '../../services/escalation';
import * as roleService from '../../services/role';
import { compileSchemaValidator, formatValidationErrors } from '../../services/role/schema-validator';
import { ESCALATION_METADATA_KEYS, ESCALATION_ENVELOPE_KEYS, assertLookupRefs, assertFileRefs, type AccumulateConfig } from '../../types/escalation';
import { mayBuild } from '../../modules/capabilities';
import { assertQueueManageAccess } from './helpers';
import type { LTApiResult, LTApiAuth } from '../../types/sdk';

const SIGNAL_KEY_MAX = 255;

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
 * @param input.accumulate opens the row as an accumulator (`{ max?, unique?, resolveAtMax? }`), so items are added before it resolves
 * @param input.signal_key creates the row once per key: a repeat returns the existing row (200)
 * @param auth — authenticated user context (must hold target role or be superadmin)
 * @returns `{ status: 201, data: <escalation record> }`; 200 with the existing row for a held key on the same role; 409 when another role's row holds it
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
    signal_key?: string;
    accumulate?: AccumulateConfig;
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
    const accumulateError = accumulateRefusal(input.accumulate);
    if (accumulateError) return { status: 400, error: accumulateError };
    const signalKey = input.signal_key;
    if (signalKey !== undefined && (typeof signalKey !== 'string' || !signalKey || signalKey.length > SIGNAL_KEY_MAX)) {
      return { status: 400, error: `signal_key must be a non-empty string of at most ${SIGNAL_KEY_MAX} characters` };
    }

    // RBAC: creating an escalation injects work into a role's queue — a write_all
    // (or global) action. read-only and self-scope members may not create.
    const denied = await assertQueueManageAccess(auth.userId, role);
    if (denied) {
      return { status: 403, error: `You must have write access to the "${role}" role or be a superadmin to create escalations for it` };
    }

    // Validate the caller-supplied metadata against the role's metadata_schema
    // (the queryable-facet contract). An escalation may carry a form-version pin
    // (metadata.schema_version) chosen by the workflow author; that is a system
    // key, not caller data, so it is excluded from validation. No version is
    // stamped here — omitting it means the resolve UI renders the role's latest
    // form at fetch time.
    const metadata = input.metadata ?? {};

    // Lookup and file refs ride the envelope under reserved keys with fixed
    // contracts, checked before the row exists.
    let carriesFiles = false;
    if (input.envelope) {
      try {
        const envelopeObj = JSON.parse(input.envelope);
        if (envelopeObj && typeof envelopeObj === 'object') {
          if (envelopeObj[ESCALATION_ENVELOPE_KEYS.LOOKUPS] !== undefined) {
            assertLookupRefs(envelopeObj[ESCALATION_ENVELOPE_KEYS.LOOKUPS]);
          }
          if (envelopeObj[ESCALATION_ENVELOPE_KEYS.FILES] !== undefined) {
            assertFileRefs(envelopeObj[ESCALATION_ENVELOPE_KEYS.FILES]);
            carriesFiles = true;
          }
        }
      } catch (refErr: any) {
        if (refErr instanceof SyntaxError) {
          return { status: 400, error: 'envelope must be valid JSON' };
        }
        return { status: 400, error: refErr.message };
      }
    }

    // A file ref grants every reader of the row a link to that object, so
    // naming one takes the same authority as reading storage directly.
    if (carriesFiles && !(await mayBuild(auth))) {
      return { status: 403, error: 'Referencing stored files takes builder access (superadmin or engineer)' };
    }

    const metadataSchema = await roleService.getRoleMetadataSchema(role);
    if (metadataSchema) {
      let validate: ValidateFunction;
      try {
        validate = compileSchemaValidator(`${role}:meta`, metadataSchema);
      } catch (compileErr: any) {
        // A broken stored schema is the role admin's bug, not the creator's.
        return { status: 422, error: `metadata_schema for role "${role}" is not a valid JSON Schema: ${compileErr.message}` };
      }
      const { [ESCALATION_METADATA_KEYS.SCHEMA_VERSION]: _pin, ...callerMetadata } = metadata;
      if (!validate(callerMetadata)) {
        return { status: 400, error: `metadata does not match the role schema: ${formatValidationErrors(validate)}` };
      }
    }

    const row = {
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
      ...(input.accumulate ? { accumulate: input.accumulate } : {}),
    };

    // Event published by service layer (services/escalation/crud.ts)
    if (signalKey === undefined) return { status: 201, data: await escalationService.createEscalation(row) };
    const { escalation, created } = await escalationService.createEscalationOnce(row, signalKey);
    if (created) return { status: 201, data: escalation };
    if (escalation.role !== role) return { status: 409, error: 'signal_key is held by another row' };
    return { status: 200, data: escalation };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}

/** Why an accumulate declaration is refused; null when it is absent or well formed. */
function accumulateRefusal(accumulate: unknown): string | null {
  if (accumulate === undefined) return null;
  if (!accumulate || typeof accumulate !== 'object' || Array.isArray(accumulate)) return 'accumulate must be an object';
  const { max, unique, resolveAtMax, ...other } = accumulate as Record<string, unknown>;
  if (Object.keys(other).length) return `accumulate takes max, unique and resolveAtMax; not ${Object.keys(other).join(', ')}`;
  if (max !== undefined && (!Number.isInteger(max) || (max as number) < 1)) return 'accumulate.max must be a positive integer';
  if (unique !== undefined && typeof unique !== 'boolean') return 'accumulate.unique must be a boolean';
  if (resolveAtMax !== undefined && typeof resolveAtMax !== 'boolean') return 'accumulate.resolveAtMax must be a boolean';
  return null;
}
