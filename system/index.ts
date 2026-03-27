/**
 * System workers and built-in MCP server factories.
 *
 * All MCP-powered workflows (triage, query, their routers and deterministic
 * counterparts) require an LLM API key. They load conditionally.
 */
export function getSystemWorkers(): Array<{ taskQueue: string; workflow: (...args: any[]) => any }> {
  const workers: Array<{ taskQueue: string; workflow: (...args: any[]) => any }> = [];

  const hasLLM = process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY;

  if (hasLLM) {
    // ── Triage pipeline (router → deterministic | dynamic) ──
    try {
      const { mcpTriageRouter } = require('./workflows/mcp-triage-router');
      workers.push({ taskQueue: 'long-tail-system', workflow: mcpTriageRouter });
    } catch { /* not available */ }

    try {
      const { mcpTriageDeterministic } = require('./workflows/mcp-triage-deterministic');
      workers.push({ taskQueue: 'long-tail-system', workflow: mcpTriageDeterministic });
    } catch { /* not available */ }

    try {
      const { mcpTriage } = require('./workflows/mcp-triage');
      workers.push({ taskQueue: 'long-tail-system', workflow: mcpTriage });
    } catch { /* not available */ }

    // ── Query pipeline (router → deterministic | dynamic) ──
    try {
      const { mcpQueryRouter } = require('./workflows/mcp-query-router');
      workers.push({ taskQueue: 'long-tail-system', workflow: mcpQueryRouter });
    } catch { /* not available */ }

    try {
      const { mcpQuery } = require('./workflows/mcp-query');
      workers.push({ taskQueue: 'long-tail-system', workflow: mcpQuery });
    } catch { /* not available */ }

    try {
      const { mcpDeterministic } = require('./workflows/mcp-deterministic');
      workers.push({ taskQueue: 'long-tail-system', workflow: mcpDeterministic });
    } catch { /* not available */ }
  }

  return workers;
}

/**
 * Built-in MCP server factories.
 * Each entry maps a server name to a lazy factory that creates the McpServer instance.
 * Registered via `registerBuiltinServer()` in `services/mcp/client.ts`.
 */
export const builtinMcpServerFactories: Record<string, () => Promise<any>> = {
  'long-tail-human-queue': () => import('./mcp-servers/human-queue').then((m) => m.createHumanQueueServer()),
  'long-tail-db': () => import('./mcp-servers/db-query').then((m) => m.createDbServer()),
  'long-tail-document-vision': () => import('./mcp-servers/document-vision').then((m) => m.createVisionServer()),
  'mcp-workflows-longtail': () => import('./mcp-servers/workflow').then((m) => m.createWorkflowServer()),
  'long-tail-workflow-compiler': () => import('./mcp-servers/workflow-compiler').then((m) => m.createWorkflowCompilerServer()),
  'long-tail-playwright': () => import('./mcp-servers/playwright').then((m) => m.createPlaywrightServer()),
  'long-tail-playwright-cli': () => import('./mcp-servers/playwright-cli').then((m) => m.createPlaywrightCliServer()),
  'long-tail-file-storage': () => import('./mcp-servers/file-storage').then((m) => m.createFileStorageServer()),
  'long-tail-http-fetch': () => import('./mcp-servers/http-fetch').then((m) => m.createHttpFetchServer()),
  'long-tail-oauth': () => import('./mcp-servers/oauth').then((m) => m.createOAuthServer()),
};
