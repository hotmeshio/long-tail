/**
 * Platform defaults — single source of truth for tunable constants.
 *
 * Every value can be overridden via the corresponding environment variable.
 * When adding a new constant, follow the pattern:
 *   env → parse → fallback to sensible default.
 *
 * Grouped by domain so related knobs live together.
 */

function envInt(key: string, fallback: number): number {
  const v = process.env[key];
  if (v === undefined || v === '') return fallback;
  const n = parseInt(v, 10);
  return Number.isNaN(n) ? fallback : n;
}

function envStr(key: string, fallback: string): string {
  return process.env[key] || fallback;
}

// ── LLM ──────────────────────────────────────────────────────────────

/** Primary model for agentic/insight workflows (tool-calling capable). */
export const LLM_MODEL_PRIMARY = envStr('LT_LLM_MODEL_PRIMARY', 'gpt-4o');

/** Lighter model for summarization, interpretation, and vision tasks. */
export const LLM_MODEL_SECONDARY = envStr('LT_LLM_MODEL_SECONDARY', 'gpt-4o-mini');

/** Base URL for OpenAI-compatible providers (Groq, Together, local). */
export const LLM_BASE_URL = process.env.LT_LLM_BASE_URL || undefined;

/** Default max_tokens when the LLM is called without tool definitions. */
export const LLM_MAX_TOKENS_DEFAULT = envInt('LT_LLM_MAX_TOKENS_DEFAULT', 1500);

/** Max tokens for structured JSON interpretation steps. */
export const LLM_MAX_TOKENS_JSON = envInt('LT_LLM_MAX_TOKENS_JSON', 800);

/** Max tokens for vision/document extraction calls. */
export const LLM_MAX_TOKENS_VISION = envInt('LT_LLM_MAX_TOKENS_VISION', 2000);

/** Truncate arrays beyond this length before sending to the LLM. */
export const LLM_MAX_ARRAY_ITEMS = envInt('LT_LLM_MAX_ARRAY_ITEMS', 25);

/** Hard character cap on serialized input payloads sent to the LLM. */
export const LLM_MAX_INPUT_CHARS = envInt('LT_LLM_MAX_INPUT_CHARS', 12_000);

// ── Tool execution ───────────────────────────────────────────────────

/** Max agentic loop iterations for MCP triage workflows. */
export const TOOL_ROUNDS_TRIAGE = envInt('LT_TOOL_ROUNDS_TRIAGE', 10);

/** Max agentic loop iterations for mcpQuery (higher — includes recall + discover + persist phases). */
export const TOOL_ROUNDS_MCP_QUERY = envInt('LT_TOOL_ROUNDS_MCP_QUERY', 15);

/** Cap on `limit` argument baked into generated YAML tool steps. */
export const TOOL_ARG_LIMIT_CAP = envInt('LT_TOOL_ARG_LIMIT_CAP', 25);

// ── Workflow execution ───────────────────────────────────────────────

/** Default graph expiry in seconds for generated YAML workflows. */
export const WORKFLOW_EXPIRE_SECS = envInt('LT_WORKFLOW_EXPIRE_SECS', 120);

/** Default job expiry in seconds for workflow executions (30 days). */
export const JOB_EXPIRE_SECS = envInt('LT_JOB_EXPIRE_SECS', 30 * 24 * 60 * 60);

/** Default timeout (ms) for synchronous workflow invocations. */
export const WORKFLOW_SYNC_TIMEOUT_MS = envInt('LT_WORKFLOW_SYNC_TIMEOUT_MS', 120_000);

/** Config cache TTL in milliseconds. */
export const CONFIG_CACHE_TTL_MS = envInt('LT_CONFIG_CACHE_TTL_MS', 5 * 60 * 1000);

// ── Query / pagination ───────────────────────────────────────────────

/** Default page size for MCP DB tool queries (find_tasks, etc.). */
export const QUERY_LIMIT_DEFAULT = envInt('LT_QUERY_LIMIT_DEFAULT', 25);

/** Maximum allowed page size for MCP DB tool queries. */
export const QUERY_LIMIT_MAX = envInt('LT_QUERY_LIMIT_MAX', 100);

/** Default page size for YAML workflow listings. */
export const YAML_LIST_LIMIT = envInt('LT_YAML_LIST_LIMIT', 50);

/** Default page size for YAML workflow version history. */
export const YAML_VERSION_LIMIT = envInt('LT_YAML_VERSION_LIMIT', 20);

// ── Escalation ──────────────────────────────────────────────────────

/**
 * Claim duration presets shown in the dashboard (minutes).
 * Override via JSON array, e.g. LT_CLAIM_DURATION_OPTIONS='[15,30,60,480]'
 */
export const CLAIM_DURATION_OPTIONS: number[] = (() => {
  const raw = process.env.LT_CLAIM_DURATION_OPTIONS;
  if (!raw) return [15, 30, 60, 240];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.every((n: any) => typeof n === 'number' && n > 0)) {
      return parsed;
    }
  } catch { /* fall through */ }
  return [15, 30, 60, 240];
})();

// ── Formatting ───────────────────────────────────────────────────────

/** YAML dump line width. */
export const YAML_LINE_WIDTH = envInt('LT_YAML_LINE_WIDTH', 120);
