import Ajv, { type ValidateFunction } from 'ajv';

/**
 * Cached-Ajv validator for a role's `metadata_schema` — used at escalation
 * CREATE to validate the caller-supplied metadata bag against the role's
 * queryable-facet contract.
 *
 * strict: false — role schemas carry the project's house extension keywords
 * (`x-lt-widget`, `x-lt-layout`, `x-lt-order`, `x-lt-span`, `x-lt-bind`). Ajv 8's
 * strict mode throws at compile on any unknown keyword, which would turn a
 * validated create into a 500. These are UI/mapping hints Ajv ignores.
 */
const ajv = new Ajv({ allErrors: true, strict: false });

// Compiled validators cached per `role@version` (or `role@version#kind`), keyed
// by the schema's serialized form so an admin's schema edit invalidates the
// stale validator on the next use. Pinned versions are immutable; the key logic
// covers both live and pinned reads.
const validatorCache = new Map<string, { key: string; validate: ValidateFunction }>();

/**
 * Compile (and cache) a validator for a role schema. Throws if the stored schema
 * is not a valid JSON Schema — callers surface that as a 422 (the role admin's
 * bug), distinct from a 400 (the submitter's payload does not match).
 */
export function compileSchemaValidator(cacheId: string, schema: Record<string, any>): ValidateFunction {
  const key = JSON.stringify(schema);
  const cached = validatorCache.get(cacheId);
  if (cached && cached.key === key) return cached.validate;
  const validate = ajv.compile(schema);
  validatorCache.set(cacheId, { key, validate });
  return validate;
}

/** Join a validator's errors into one human-readable line (instancePath + message). */
export function formatValidationErrors(validate: ValidateFunction): string {
  return (validate.errors ?? []).map((e) => `${e.instancePath || '(root)'} ${e.message}`).join('; ');
}
