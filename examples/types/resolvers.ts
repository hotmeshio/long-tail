/**
 * Typed resolver payloads — what the operator sends when resolving
 * an escalation via POST /api/escalations/:id/resolve.
 *
 * Every resolver payload may include an `_lt` block for routing
 * control (e.g., flagging that the escalation needs AI triage).
 */

// ── Base ────────────────────────────────────────────────────────

/** Control block available on all resolver payloads. */
export interface ResolverLTBlock {
  /** Flag for AI triage — routes to the mcpTriage orchestrator. */
  needsTriage?: boolean;
  /** Hint for the triage workflow (e.g., 'image_orientation'). */
  hint?: string;
}

/** Base resolver payload — all resolvers may include _lt. */
export interface BaseResolverPayload {
  _lt?: ResolverLTBlock;
}

// ── reviewContent ───────────────────────────────────────────────

/** Resolver payload when a reviewer resolves a content escalation. */
export interface ReviewContentResolverPayload extends BaseResolverPayload {
  approved: boolean;
  analysis?: {
    confidence: number;
    flags: string[];
    summary: string;
  };
}

// ── verifyDocument / verifyDocumentMcp ──────────────────────────

/** Resolver payload when a reviewer resolves a document escalation. */
export interface VerifyDocumentResolverPayload extends BaseResolverPayload {
  memberId?: string;
  extractedInfo?: Record<string, any>;
  validationResult?: 'match' | 'mismatch' | 'not_found';
  confidence?: number;
}
