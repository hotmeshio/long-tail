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

// ── basicSignal ──────────────────────────────────────────────

/** Basic signal — lightweight escalation via conditionLT. */
export interface BasicSignalEnvelopeData {
  /** Message shown to the reviewer in the escalation description. */
  message?: string;
  /** Role to assign the escalation to. */
  role?: string;
}

// ── assemblyLine ─────────────────────────────────────────────

/** Assembly line — durable orchestrator with sequential human task queues. */
export interface AssemblyLineEnvelopeData {
  /** Product name for the assembly run. */
  productName: string;
  /** Ordered stations the product passes through. */
  stations: Array<{
    stationName: string;
    role: string;
    instructions: string;
  }>;
}

// ── stepIterator ─────────────────────────────────────────────

/** Step iterator — generic loop over data-driven steps with human escalations. */
export interface StepIteratorEnvelopeData {
  /** Display name for this run. */
  name: string;
  /** Dynamic list of steps — each spawns a child workflow with an escalation. */
  steps: Array<{
    stationName: string;
    role: string;
    instructions: string;
  }>;
}

// ── reverter ─────────────────────────────────────────────────

/** Reverter — step loop with revert support (same shape as stepIterator). */
export type ReverterEnvelopeData = StepIteratorEnvelopeData;

// ── Workflow envelope map ───────────────────────────────────────

/** Map of invocable workflow type → its typed envelope data shape. */
export type WorkflowEnvelopeMap = {
  reviewContent: ReviewContentEnvelopeData;
  kitchenSink: KitchenSinkEnvelopeData;
  basicEcho: BasicEchoEnvelopeData;
  basicSignal: BasicSignalEnvelopeData;
  assemblyLine: AssemblyLineEnvelopeData;
  stepIterator: StepIteratorEnvelopeData;
  reverter: ReverterEnvelopeData;
};

/** All invocable workflow type names. */
export type InvocableWorkflowType = keyof WorkflowEnvelopeMap;
