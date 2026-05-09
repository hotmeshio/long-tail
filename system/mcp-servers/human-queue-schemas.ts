import { z } from 'zod';

// ── Schemas (extracted to break TS2589 deep-instantiation in registerTool generics) ──

export const escalateSchema = z.object({
  role: z.string().describe('Target role for the escalation (e.g., "reviewer")'),
  message: z.string().describe('Description of what needs human review'),
  data: z.record(z.any()).optional().describe('Contextual data for the reviewer'),
  type: z.string().optional().default('mcp').describe('Escalation type classification'),
  subtype: z.string().optional().default('tool_call').describe('Escalation subtype'),
  priority: z.number().min(1).max(4).optional().default(2)
    .describe('Priority: 1 (highest) to 4 (lowest)'),
});

export const checkResolutionSchema = z.object({
  escalation_id: z.string().describe('The escalation ID to check'),
});

export const getAvailableWorkSchema = z.object({
  role: z.string().describe('Role to filter by'),
  limit: z.number().optional().default(10).describe('Max results to return'),
});

export const claimAndResolveSchema = z.object({
  escalation_id: z.string().describe('The escalation ID to claim and resolve'),
  resolver_id: z.string().describe('Identifier for who/what is resolving'),
  payload: z.record(z.any()).describe('Resolution payload data'),
});

export const resolveEscalationSchema = z.object({
  escalation_id: z.string().describe('The escalation ID to resolve'),
  payload: z.record(z.any()).describe('Resolution payload data'),
});

export const escalateAndWaitSchema = z.object({
  role: z.string().describe('Target role for the escalation (e.g., "reviewer")'),
  message: z.string().describe('Description of what input is needed from the human'),
  form_schema: z.record(z.any()).optional()
    .describe('JSON Schema for the resolver form. Use format:"password" for sensitive fields.'),
  data: z.record(z.any()).optional().describe('Contextual data for the reviewer'),
  assigned_to: z.string().optional().describe('Auto-assign to a specific user'),
  type: z.string().optional().default('mcp').describe('Escalation type classification'),
  subtype: z.string().optional().default('wait_for_human').describe('Escalation subtype'),
  priority: z.number().min(1).max(4).optional().default(1)
    .describe('Priority: 1 (highest) to 4 (lowest)'),
}).passthrough();
