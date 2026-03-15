-- Remove invocable from verify-document orchestrators.
-- These require OpenAI Vision API keys and fixture images — not useful
-- as user-invocable workflows on the Start page.
UPDATE lt_config_workflows SET invocable = false
WHERE workflow_type IN ('verifyDocumentOrchestrator', 'verifyDocumentMcpOrchestrator');

-- Add description to reviewContentOrchestrator (if missing).
UPDATE lt_config_workflows SET description = 'Content review — AI-powered moderation with human escalation for low-confidence results'
WHERE workflow_type = 'reviewContentOrchestrator' AND description IS NULL;

-- Add description to processClaimOrchestrator (if missing).
UPDATE lt_config_workflows SET description = 'Insurance claim processing — document analysis, validation, and human review'
WHERE workflow_type = 'processClaimOrchestrator' AND description IS NULL;
