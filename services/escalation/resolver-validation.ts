/**
 * Server-side resolver schema enforcement — the API-first counterpart of the
 * dashboard's pre-submission pass. Every resolve surface (HTTP, SDK, MCP)
 * calls checkResolverPayload before committing a resolution; roles that opt in
 * via enforce_schema get their form_schema enforced as an API contract, and
 * violations surface as the canonical 422 body (types/validation.ts).
 *
 * Production shape: the gate consults the cached enforcing-role set first, so
 * when no involved role enforces, a resolve costs zero additional SQL. Schema
 * reads for enforcing roles come from the enforcement cache (immutable pinned
 * snapshots cached indefinitely; latest schemas under a short TTL).
 *
 * Schema resolution matches the resolve UI, most specific first:
 *   1. metadata.form_schema — a full form embedded on the row
 *   2. the lt_role_schemas snapshot pinned by metadata.schema_version
 *   3. the role's live (latest) form_schema
 * A role that enforces but declares no schema has no contract to enforce —
 * the gate passes.
 */
import { validateResolverPayload } from '../../shared/form-validation';
import { getEnforcingRoles, getEnforcedFormSchema } from '../role/enforcement-cache';
import { ESCALATION_METADATA_KEYS } from '../../types/escalation';
import { LT_ERROR_CODES, type LTFieldViolation, type LTValidationErrorBody } from '../../types/validation';

/** The row fields the gate reads — every resolve surface already holds these. */
export interface ResolvableEscalationRow {
  id: string;
  role: string | null;
  metadata?: Record<string, any> | null;
  envelope?: string | null;
  escalation_payload?: string | null;
  [key: string]: any;
}

/** A failed check: which role's contract rejected, at which version, and why. */
export interface ResolverSchemaViolationReport {
  role: string;
  schemaVersion: number | null;
  violations: LTFieldViolation[];
}

function parseJsonOrNull(value: string | null | undefined): Record<string, any> | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return typeof parsed === 'object' && parsed !== null ? parsed : null;
  } catch {
    return null;
  }
}

/** The row's schema-version pin as an integer, mirroring the SQL's guarded cast. */
function pinnedVersionOf(metadata: Record<string, any>): number | null {
  const raw = metadata[ESCALATION_METADATA_KEYS.SCHEMA_VERSION];
  if (typeof raw === 'number' && Number.isInteger(raw) && raw >= 1) return raw;
  if (typeof raw === 'string' && /^[0-9]+$/.test(raw)) return parseInt(raw, 10);
  return null;
}

/**
 * Validate a submitted resolverPayload against the escalation's enforced form
 * schema. Returns null when the resolution may proceed (role does not enforce,
 * no schema to enforce, or the payload passes); otherwise the violation report.
 *
 * `loadEnvelope` lets a caller supply a richer envelope read (e.g. the by-id
 * surface's task fallback); by default the row's own envelope column is used.
 * It is only invoked when the role actually enforces.
 */
export async function checkResolverPayload(
  escalation: ResolvableEscalationRow,
  resolverPayload: Record<string, any>,
  loadEnvelope?: () => Promise<Record<string, any>>,
): Promise<ResolverSchemaViolationReport | null> {
  const role = escalation.role;
  if (!role) return null;

  const enforcing = await getEnforcingRoles();
  if (!enforcing.has(role)) return null;

  const metadata = (escalation.metadata ?? {}) as Record<string, any>;
  const pin = pinnedVersionOf(metadata);

  const embedded = metadata[ESCALATION_METADATA_KEYS.FORM_SCHEMA];
  const schema: Record<string, any> | null =
    embedded && typeof embedded === 'object'
      ? (embedded as Record<string, any>)
      : await getEnforcedFormSchema(role, pin);
  if (!schema) return null;

  const envelope = loadEnvelope
    ? await loadEnvelope()
    : parseJsonOrNull(escalation.envelope) ?? {};

  const violations = validateResolverPayload(schema, resolverPayload, {
    escalation: escalation as Record<string, unknown>,
    metadata,
    envelope,
    payload: parseJsonOrNull(escalation.escalation_payload),
  });
  if (violations.length === 0) return null;

  return { role, schemaVersion: pin, violations };
}

/** The canonical 422 body for a violation report (types/validation.ts). */
export function toValidationErrorBody(report: ResolverSchemaViolationReport): LTValidationErrorBody {
  const n = report.violations.length;
  return {
    error: `resolverPayload failed schema validation (${n} violation${n === 1 ? '' : 's'})`,
    code: LT_ERROR_CODES.SCHEMA_VALIDATION,
    violations: report.violations,
    role: report.role,
    schemaVersion: report.schemaVersion,
  };
}
