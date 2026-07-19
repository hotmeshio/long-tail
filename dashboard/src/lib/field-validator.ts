export interface FieldError { field: string; message: string }

interface ChecklistItem { id: string; label: string; required?: boolean }

/**
 * Resolve a checklist widget's item definitions from its `x-lt-source`
 * "domain.path" against the escalation context. Missing domain/path or a
 * non-array value yields an empty list.
 */
export function resolveChecklistItems(
  sourcePath: unknown,
  ctx: Record<string, unknown> | undefined,
): ChecklistItem[] {
  if (typeof sourcePath !== 'string' || !ctx) return [];
  const dot = sourcePath.indexOf('.');
  if (dot === -1) return [];
  const domainObj = ctx[sourcePath.slice(0, dot)];
  if (!domainObj || typeof domainObj !== 'object') return [];
  let cur: unknown = domainObj;
  for (const p of sourcePath.slice(dot + 1).split('.')) {
    cur = (cur as Record<string, unknown>)[p];
    if (cur === undefined) return [];
  }
  return Array.isArray(cur) ? (cur as ChecklistItem[]) : [];
}

/**
 * The checklist completion guard (`x-lt-require-all`): every rendered item must
 * be checked, except items whose definition carries `required: false` (the
 * explicit opt-out). Vacuous when the source resolves to no items — never
 * blocks on zero. Returns the panel message, or undefined when satisfied.
 * Stricter than (and composes with) the field-level required-array entry,
 * which remains the at-least-one check.
 */
export function validateRequireAll(
  value: unknown,
  fieldSchema: Record<string, unknown> | undefined,
  ctx?: Record<string, unknown>,
): string | undefined {
  if (fieldSchema?.['x-lt-widget'] !== 'checklist') return undefined;
  if (fieldSchema['x-lt-require-all'] !== true) return undefined;

  const items = resolveChecklistItems(fieldSchema['x-lt-source'], ctx);
  const mandatory = items.filter((i) => i.required !== false);
  if (mandatory.length === 0) return undefined;

  const state = (typeof value === 'object' && value !== null && !Array.isArray(value))
    ? (value as Record<string, unknown>)
    : {};
  const incomplete = mandatory.filter((i) => !state[i.id]).length;
  if (incomplete === 0) return undefined;
  return `${incomplete} of ${mandatory.length} checks incomplete`;
}

/**
 * Per-field JSON Schema validation — subset used by the resolver form.
 *
 * Returns a human-readable error string when the value fails a constraint,
 * or undefined when the value is valid. Callers are responsible for the
 * required check (empty-when-required) before calling this for constraint checks.
 *
 * `ctx` is optional context (ShowIfContext-shaped) used to resolve dynamic
 * constraint paths like `x-lt-minimum: "envelope.min_score"`.
 */
export function validateFieldConstraints(
  value: unknown,
  fieldSchema: Record<string, unknown> | undefined,
  ctx?: Record<string, unknown>,
): string | undefined {
  if (!fieldSchema) return undefined;

  if (typeof value === 'string') {
    const s = value.trim();
    if (s === '') return undefined; // empty string: required check is the caller's job

    const minLength = resolveNumericConstraint(fieldSchema.minLength, fieldSchema['x-lt-min-length'], ctx);
    if (minLength !== undefined && s.length < minLength) {
      return `Minimum ${minLength} character${minLength === 1 ? '' : 's'}`;
    }

    const maxLength = resolveNumericConstraint(fieldSchema.maxLength, fieldSchema['x-lt-max-length'], ctx);
    if (maxLength !== undefined && s.length > maxLength) {
      return `Maximum ${maxLength} characters (${s.length} entered)`;
    }

    const pattern = fieldSchema.pattern as string | undefined;
    if (pattern) {
      try {
        if (!new RegExp(pattern).test(s)) {
          const patternError = fieldSchema['x-lt-pattern-error'] as string | undefined;
          return patternError ?? 'Invalid format';
        }
      } catch {
        // Malformed pattern in schema — silently skip
      }
    }

    const fmt = fieldSchema.format as string | undefined;
    if (fmt === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) {
      return 'Enter a valid email address';
    }
    if (fmt === 'uri' && !/^https?:\/\/.+/.test(s)) {
      return 'Enter a valid URL';
    }
  }

  if (typeof value === 'number') {
    const minimum = resolveNumericConstraint(fieldSchema.minimum, fieldSchema['x-lt-minimum'], ctx);
    const exclusiveMinimum = resolveNumericConstraint(fieldSchema.exclusiveMinimum, undefined, ctx);
    const maximum = resolveNumericConstraint(fieldSchema.maximum, fieldSchema['x-lt-maximum'], ctx);
    const exclusiveMaximum = resolveNumericConstraint(fieldSchema.exclusiveMaximum, undefined, ctx);

    if (minimum !== undefined && value < minimum) {
      return `Minimum value is ${minimum}`;
    }
    if (exclusiveMinimum !== undefined && value <= exclusiveMinimum) {
      return `Must be greater than ${exclusiveMinimum}`;
    }
    if (maximum !== undefined && value > maximum) {
      return `Maximum value is ${maximum}`;
    }
    if (exclusiveMaximum !== undefined && value >= exclusiveMaximum) {
      return `Must be less than ${exclusiveMaximum}`;
    }
  }

  return undefined;
}

function resolveNumericConstraint(
  staticVal: unknown,
  dynamicPath: unknown,
  ctx: Record<string, unknown> | undefined,
): number | undefined {
  if (typeof staticVal === 'number') return staticVal;
  if (typeof dynamicPath === 'string' && ctx) {
    const dot = dynamicPath.indexOf('.');
    if (dot !== -1) {
      const domain = dynamicPath.slice(0, dot);
      const path = dynamicPath.slice(dot + 1);
      const domainObj = ctx[domain];
      if (domainObj && typeof domainObj === 'object') {
        const parts = path.split('.');
        let cur: unknown = domainObj;
        for (const p of parts) {
          cur = (cur as Record<string, unknown>)[p];
          if (cur === undefined) break;
        }
        if (typeof cur === 'number') return cur;
        if (typeof cur === 'string') {
          const n = Number(cur);
          if (!Number.isNaN(n)) return n;
        }
      }
    }
  }
  return undefined;
}

/** Full field error including required check then constraints. */
export function validateField(
  value: unknown,
  fieldSchema: Record<string, unknown> | undefined,
  isRequired: boolean,
  isTouched: boolean,
  ctx?: Record<string, unknown>,
): string | undefined {
  if (!isTouched) return undefined;

  if (isRequired) {
    if (value === undefined || value === null) return 'Required';
    if (typeof value === 'boolean' && !value) return 'Required';
    if (typeof value === 'string' && value.trim() === '') return 'Required';
    if (typeof value === 'object' && !Array.isArray(value) && value !== null) {
      const vals = Object.values(value as Record<string, unknown>);
      if (vals.length === 0 || vals.every((v) => !v)) return 'Required';
    }
  }

  // Checklist completion — the stricter guard runs regardless of the
  // required-array entry (which stays at-least-one when present).
  const requireAll = validateRequireAll(value, fieldSchema, ctx);
  if (requireAll) return requireAll;

  return validateFieldConstraints(value, fieldSchema, ctx);
}
