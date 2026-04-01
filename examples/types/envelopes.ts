/**
 * Typed envelope data shapes for each invocable workflow.
 *
 * These define the API contract — what the Start Workflow page
 * and REST callers send as `envelope.data` when invoking a workflow.
 */

// ── reviewContent ───────────────────────────────────────────────

/** Content to review — article, comment, or other text submission. */
export interface ReviewContentEnvelopeData {
  contentId: string;
  content: string;
  contentType?: string;
}

// ── verifyDocument ──────────────────────────────────────────────

/** Document to verify — image-based identity or membership document. */
export interface VerifyDocumentEnvelopeData {
  documentId: string;
  documentUrl: string;
  documentType?: string;
  memberId?: string;
}

// ── processClaim ────────────────────────────────────────────────

/** Insurance claim with document images to process. */
export interface ProcessClaimEnvelopeData {
  claimId: string;
  claimantId: string;
  claimType: string;
  amount: number;
  documents: string[];
}

// ── kitchenSink ─────────────────────────────────────────────────

/** Kitchen sink — showcases every Durable primitive. */
export interface KitchenSinkEnvelopeData {
  /** Name used in the greeting activity. */
  name?: string;
  /** 'full' pauses for human review; 'quick' auto-completes. */
  mode?: 'full' | 'quick';
}

// ── basicEcho ─────────────────────────────────────────────────

/** Basic echo — minimal durable workflow with IAM context. */
export interface BasicEchoEnvelopeData {
  /** Message to echo back. */
  message?: string;
  /** Duration to sleep before echoing (seconds). */
  sleepSeconds?: number;
}

// ── Workflow envelope map ───────────────────────────────────────

/** Map of invocable workflow type → its typed envelope data shape. */
export type WorkflowEnvelopeMap = {
  reviewContent: ReviewContentEnvelopeData;
  verifyDocument: VerifyDocumentEnvelopeData;
  processClaim: ProcessClaimEnvelopeData;
  kitchenSink: KitchenSinkEnvelopeData;
  basicEcho: BasicEchoEnvelopeData;
};

/** All invocable workflow type names. */
export type InvocableWorkflowType = keyof WorkflowEnvelopeMap;
