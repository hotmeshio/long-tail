import * as mcpTriageWorkflow from './workflows/mcp-triage';

/**
 * System workers that always load with Long Tail.
 * mcp-triage is always available; insight and mcp-query
 * load when OPENAI_API_KEY is configured.
 */
export function getSystemWorkers(): Array<{ taskQueue: string; workflow: (...args: any[]) => any }> {
  const workers: Array<{ taskQueue: string; workflow: (...args: any[]) => any }> = [
    { taskQueue: 'long-tail-system', workflow: mcpTriageWorkflow.mcpTriage },
  ];

  if (process.env.OPENAI_API_KEY) {
    // Lazy-require to avoid loading OpenAI when not configured
    try {
      const { insightQuery } = require('./workflows/insight');
      workers.push({ taskQueue: 'long-tail-system', workflow: insightQuery });
    } catch { /* insight not available */ }

    try {
      const { mcpQuery } = require('./workflows/mcp-query');
      workers.push({ taskQueue: 'long-tail-system', workflow: mcpQuery });
    } catch { /* mcp-query not available */ }
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
  'long-tail-file-storage': () => import('./mcp-servers/file-storage').then((m) => m.createFileStorageServer()),
  'long-tail-http-fetch': () => import('./mcp-servers/http-fetch').then((m) => m.createHttpFetchServer()),
};
