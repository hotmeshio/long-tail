import type { ResolverValidationContext } from './validate-resolver-payload';

/**
 * The context an invoke form validates and renders against. The pass itself
 * supplies the live values under `input` and `resolver`; the envelope
 * metadata is the only other domain an invoke form can reference.
 */
export function buildInvokeFormContext(
  metadata: Record<string, unknown> | null | undefined,
): ResolverValidationContext {
  return { metadata: metadata ?? {} };
}
