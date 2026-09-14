import type { ResolverValidationContext } from './validate-resolver-payload';

/**
 * The context an invoke form validates and renders against. The pass itself
 * supplies the live values under `input` and `resolver`; `metadata` is the
 * envelope metadata and `lookup` holds resolved versioned knowledge editions
 * keyed by `as ?? key`. The lookup domain is present only when supplied.
 */
export function buildInvokeFormContext(
  metadata: Record<string, unknown> | null | undefined,
  lookup?: Record<string, unknown> | null,
): ResolverValidationContext {
  return { metadata: metadata ?? {}, ...(lookup ? { lookup } : {}) };
}
