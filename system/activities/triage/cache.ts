import type { ToolDefinition } from '../../../services/llm';

// ── Tool caches (module-level, persist across proxy activity calls) ──

/** Maps qualified tool name → MCP server name for routing calls */
export const toolServerMap = new Map<string, string>();

/** Tracks which qualified names are compiled YAML workflows */
export const yamlWorkflowMap = new Map<string, string>();

/** Maps qualified tool name → full ChatCompletionTool definition */
export const toolDefCache = new Map<string, ToolDefinition>();
