/**
 * Typed envelope data shapes for each invocable orchestrator.
 *
 * These define the API contract — what the Start Workflow page
 * and REST callers send as `envelope.data` when invoking a workflow.
 */

// ── reviewContentOrchestrator ───────────────────────────────────

/** Content to review — article, comment, or other text submission. */
export interface ReviewContentEnvelopeData {
  contentId: string;
  content: string;
  contentType?: string;
}

// ── verifyDocumentOrchestrator / verifyDocumentMcpOrchestrator ──

/** Document to verify — image-based identity or membership document. */
export interface VerifyDocumentEnvelopeData {
  documentId: string;
  documentUrl: string;
  documentType?: string;
  memberId?: string;
}

// ── Workflow envelope map ───────────────────────────────────────

/** Map of invocable workflow type → its typed envelope data shape. */
export type WorkflowEnvelopeMap = {
  reviewContentOrchestrator: ReviewContentEnvelopeData;
  verifyDocumentOrchestrator: VerifyDocumentEnvelopeData;
  verifyDocumentMcpOrchestrator: VerifyDocumentEnvelopeData;
};

/** All invocable workflow type names. */
export type InvocableWorkflowType = keyof WorkflowEnvelopeMap;

// ── JSON templates ──────────────────────────────────────────────

/**
 * Default envelope templates for each invocable workflow.
 * Used by the Start Workflow page to pre-fill the JSON editor
 * and by `seedExamples` for demonstration data.
 */
export const ENVELOPE_TEMPLATES: {
  [K in InvocableWorkflowType]: {
    data: WorkflowEnvelopeMap[K];
    metadata: Record<string, any>;
  };
} = {
  reviewContentOrchestrator: {
    data: {
      contentId: 'article-001',
      content: 'Content to review...',
      contentType: 'article',
    },
    metadata: { source: 'dashboard' },
  },
  verifyDocumentOrchestrator: {
    data: {
      documentId: 'doc-001',
      documentUrl: 'https://example.com/doc.jpg',
      documentType: 'drivers_license',
      memberId: 'member-12345',
    },
    metadata: { source: 'dashboard' },
  },
  verifyDocumentMcpOrchestrator: {
    data: {
      documentId: 'doc-001',
      documentUrl: 'https://example.com/doc.jpg',
      documentType: 'drivers_license',
      memberId: 'member-12345',
    },
    metadata: { source: 'dashboard' },
  },
};
