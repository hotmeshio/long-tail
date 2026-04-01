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
}

/** Base resolver payload — all resolvers may include _lt and notes. */
export interface BaseResolverPayload {
  _lt?: ResolverLTBlock;
  /** Human description of the problem — the LLM uses this for diagnosis. */
  notes?: string;
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

// ── processClaim ────────────────────────────────────────────────

/** Resolver payload when a reviewer resolves a claim escalation. */
export interface ProcessClaimResolverPayload extends BaseResolverPayload {
  approved?: boolean;
  status?: string;
  analysis?: {
    confidence: number;
    flags: string[];
    summary: string;
  };
}

// ── verifyDocument ──────────────────────────────────────────────

/** Resolver payload when a reviewer resolves a document escalation. */
export interface VerifyDocumentResolverPayload extends BaseResolverPayload {
  memberId?: string;
  extractedInfo?: Record<string, any>;
  validationResult?: 'match' | 'mismatch' | 'not_found';
  confidence?: number;
}
