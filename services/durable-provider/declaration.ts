import { foldEscalationConfig } from '@hotmeshio/hotmesh/build/services/escalations';

import type { LTOpenWaitInput } from '../../types/durable-provider';

/** A batch or accumulate declaration the escalation store refuses. */
export class WaitDeclarationError extends Error {
  public cause?: unknown;

  constructor(message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = 'WaitDeclarationError';
    this.cause = options?.cause;
  }
}

/**
 * The stored metadata and envelope for a wait: a `batch` or `accumulate`
 * declaration folds into the same row shape HotMesh's `condition()` writes,
 * so every item, flag and resolve surface works on the row.
 */
export function foldWaitDeclaration(input: LTOpenWaitInput): {
  metadata: Record<string, unknown> | null;
  envelope: Record<string, unknown>;
} {
  const { batch, partialOnTimeout, wakeOnFlag, wakeOnFill, filled, accumulate } = input;
  try {
    const folded = foldEscalationConfig({
      batch, partialOnTimeout, wakeOnFlag, wakeOnFill, filled, accumulate,
      metadata: input.metadata,
      envelope: {},
    });
    return { metadata: folded.metadata ?? null, envelope: folded.envelope ?? {} };
  } catch (err) {
    throw new WaitDeclarationError(err instanceof Error ? err.message : String(err), { cause: err });
  }
}
