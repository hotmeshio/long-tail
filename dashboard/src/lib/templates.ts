/**
 * Typed resolver templates per workflow type.
 * Mirrors the canonical types in examples/types/resolvers.ts.
 */
export const RESOLVER_TEMPLATES: Record<string, object> = {
  reviewContent: {
    approved: true,
    analysis: {
      confidence: 0.95,
      flags: [],
      summary: 'Manually reviewed and approved.',
    },
  },
  verifyDocument: {
    memberId: '',
    extractedInfo: {},
    validationResult: 'match',
    confidence: 1.0,
  },
  verifyDocumentMcp: {
    memberId: '',
    extractedInfo: {},
    validationResult: 'match',
    confidence: 1.0,
  },
};

/**
 * Envelope templates for known invocable workflows.
 * Mirrors the canonical types in examples/types/envelopes.ts.
 */
export const INVOCATION_TEMPLATES: Record<string, object> = {
  reviewContentOrchestrator: {
    data: { contentId: 'article-001', content: 'Content to review...', contentType: 'article' },
    metadata: { source: 'dashboard' },
  },
  verifyDocumentOrchestrator: {
    data: { documentId: 'doc-001', documentUrl: 'https://example.com/doc.jpg', documentType: 'drivers_license', memberId: 'member-12345' },
    metadata: { source: 'dashboard' },
  },
  verifyDocumentMcpOrchestrator: {
    data: { documentId: 'doc-001', documentUrl: 'https://example.com/doc.jpg', documentType: 'drivers_license', memberId: 'member-12345' },
    metadata: { source: 'dashboard' },
  },
};

export function getResolverTemplate(workflowType: string | null): string {
  const template = workflowType ? RESOLVER_TEMPLATES[workflowType] : undefined;
  return JSON.stringify(template ?? {}, null, 2);
}

export function getInvocationTemplate(workflowType: string): string {
  const template = INVOCATION_TEMPLATES[workflowType];
  return template ? JSON.stringify(template, null, 2) : '{\n  \n}';
}
