import {
  ESCALATION_ENVELOPE_KEYS,
  ESCALATION_METADATA_KEYS,
  assertFileRefs,
  assertLookupRefs,
} from '../../types/escalation';
import type { LTOpenWaitInput } from '../../types/durable-provider';

type FoldEscalationConfig = typeof import('@hotmeshio/hotmesh/build/services/escalations').foldEscalationConfig;

/** A batch or accumulate declaration the escalation store refuses. */
export class WaitDeclarationError extends Error {
  public cause?: unknown;

  constructor(message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = 'WaitDeclarationError';
    this.cause = options?.cause;
  }
}

/** Envelope key prefixes the batch and accumulate fold writes. */
const RESERVED_ENVELOPE_PREFIXES = ['batch_', 'accumulate_'];

/**
 * The stored metadata and envelope for a wait, in the shape HotMesh's
 * `conditional()` writes: `schemaVersion` into metadata, `lookups` and
 * `files` into the envelope, then the `batch` or `accumulate` declaration,
 * so every form, item, flag and resolve surface works on the row.
 */
export function foldWaitDeclaration(input: LTOpenWaitInput): {
  metadata: Record<string, unknown> | null;
  envelope: Record<string, unknown>;
} {
  const { batch, partialOnTimeout, wakeOnFlag, wakeOnFill, filled, accumulate } = input;
  // Resolved on first use, so only a provider deployment depends on the SDK module path.
  const { foldEscalationConfig } = require('@hotmeshio/hotmesh/build/services/escalations') as { foldEscalationConfig: FoldEscalationConfig };
  const envelope = envelopeOf(input);
  try {
    const folded = foldEscalationConfig({
      batch, partialOnTimeout, wakeOnFlag, wakeOnFill, filled, accumulate,
      metadata: metadataOf(input),
      envelope,
    });
    return { metadata: folded.metadata ?? null, envelope: folded.envelope ?? {} };
  } catch (err) {
    throw new WaitDeclarationError(err instanceof Error ? err.message : String(err), { cause: err });
  }
}

function metadataOf(input: LTOpenWaitInput): Record<string, unknown> | undefined {
  if (input.schemaVersion == null) return input.metadata;
  return { ...input.metadata, [ESCALATION_METADATA_KEYS.SCHEMA_VERSION]: input.schemaVersion };
}

function envelopeOf(input: LTOpenWaitInput): Record<string, unknown> {
  const envelope = input.envelope ?? {};
  const reserved = Object.keys(envelope).find((key) => RESERVED_ENVELOPE_PREFIXES.some((prefix) => key.startsWith(prefix)));
  if (reserved) throw new WaitDeclarationError(`envelope.${reserved} is reserved for batch and accumulate waits`);
  for (const [field, key] of [['lookups', ESCALATION_ENVELOPE_KEYS.LOOKUPS], ['files', ESCALATION_ENVELOPE_KEYS.FILES]] as const) {
    if (input[field] != null && key in envelope) {
      throw new WaitDeclarationError(`pass ${field} or envelope.${key}, not both`);
    }
  }
  try {
    if (input.lookups != null) assertLookupRefs(input.lookups);
    if (input.files != null) assertFileRefs(input.files);
  } catch (err) {
    throw new WaitDeclarationError(err instanceof Error ? err.message : String(err), { cause: err });
  }
  return {
    ...envelope,
    ...(input.lookups != null ? { [ESCALATION_ENVELOPE_KEYS.LOOKUPS]: input.lookups } : {}),
    ...(input.files != null ? { [ESCALATION_ENVELOPE_KEYS.FILES]: input.files } : {}),
  };
}
