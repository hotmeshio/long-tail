/**
 * Basic Signal Activities
 *
 * Simple activity for post-resolution processing. The escalation
 * creation and resolution are handled via interceptor activities
 * (ltCreateEscalation / ltResolveEscalation) proxied from the workflow.
 */

export async function processApproval(input: {
  approved: boolean;
  notes: string;
  message: string;
}): Promise<{
  message: string;
  approved: boolean;
  notes: string;
  processedAt: string;
}> {
  return {
    message: input.message,
    approved: input.approved,
    notes: input.notes,
    processedAt: new Date().toISOString(),
  };
}
