// ── Ortho example connector tool manifest ────────────────────────────────────
// Accompanies the ortho-pipeline example workflow. Loaded conditionally by
// system/index.ts and excluded from the npm package (examples/ is not shipped).
// Each entry mirrors the exact tool registered in examples/mcp-servers/ortho.ts

export const ORTHO_TOOLS = [
  { name: 'ortho_submit', description: 'Start a new orthotic manufacturing order through the 8-stage pipeline (design → review → print → grind → glue → finish → qa → ship). Returns a workflow_id used to track progress.', read_safe: false, inputSchema: { type: 'object', properties: { order_id: { type: 'string' }, item_type: { type: 'string' }, stages: { type: 'array', items: { type: 'string' } }, metadata: { type: 'object' } }, required: ['order_id', 'item_type'] } },
  { name: 'ortho_pending', description: 'List open ortho-pipeline stage escalations waiting to be completed. Optionally filter by stage name. Returns escalation IDs for use with ortho_complete_stage.', read_safe: true, inputSchema: { type: 'object', properties: { stage: { type: 'string' }, limit: { type: 'integer' } } } },
  { name: 'ortho_complete_stage', description: 'Complete a pending ortho pipeline stage escalation. Resolving automatically advances the workflow to the next stage.', read_safe: false, inputSchema: { type: 'object', properties: { escalation_id: { type: 'string' }, notes: { type: 'string' }, outcome: { type: 'object' } }, required: ['escalation_id', 'notes'] } },
  { name: 'ortho_status', description: 'Get the current status and completed stage results for an ortho pipeline workflow. Returns "running" while in progress or "complete" with the full stage history.', read_safe: true, inputSchema: { type: 'object', properties: { workflow_id: { type: 'string' } }, required: ['workflow_id'] } },
];
