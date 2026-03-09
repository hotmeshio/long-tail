# Create an MCP Server

This is the story of how we built a browser automation tool for Long Tail — and the guide for building your own.

We needed screenshots for our QA documentation. Rather than capture them by hand, we wrapped Playwright in an MCP server. Now the triage agent can *see* the dashboard, click through flows, and capture evidence. And when the pattern is proven, we'll compile it into a deterministic YAML workflow that generates documentation on every deploy.

This guide covers the full journey: creating a custom MCP server, registering it with Long Tail, building workflows that use it, and deploying hardened pipelines. By the end, you'll understand how to give the triage system any capability — browser automation, S3 uploads, Slack notifications, PDF generation — by wrapping it in 50 lines of tool registration code.

---

## Table of Contents

1. [The Pattern](#1-the-pattern)
2. [Building the Playwright Server](#2-building-the-playwright-server)
3. [Registering with Long Tail](#3-registering-with-long-tail)
4. [Testing Your Server](#4-testing-your-server)
5. [Building Workflows That Use It](#5-building-workflows-that-use-it)
6. [Creating Custom Activities](#6-creating-custom-activities)
7. [The Full Workflow: Screenshot Capture](#7-the-full-workflow-screenshot-capture)
8. [From Triage to YAML: Hardening the Fix](#8-from-triage-to-yaml-hardening-the-fix)
9. [Your Own MCP Server: A Template](#9-your-own-mcp-server-a-template)
10. [Ideas: What to Wrap Next](#10-ideas-what-to-wrap-next)

---

## 1. The Pattern

Every MCP server in Long Tail follows the same three-file pattern:

```
services/mcp/
├── your-server.ts      # McpServer factory + tool registration
```

And integrates via two registration points:

```
start.ts                # registerBuiltinServer('name', factory)
examples/index.ts       # Seed tool manifest for dashboard visibility
```

That's it. Once registered, your tools are:

- **Visible to the triage agent** — it discovers them via `getAvailableTools()`
- **Callable from any workflow** — via `mcpClient.callServerTool()`
- **Auto-connected on first use** — the `resolveClient` mechanism lazy-launches your server
- **Compilable into YAML** — successful triage patterns become deterministic pipelines

The server itself is stateless from Long Tail's perspective. It gets a fresh `McpServer` instance per consumer, communicating over `InMemoryTransport`. No ports, no processes, no configuration files.

---

## 2. Building the Playwright Server

Here's `services/mcp/playwright-server.ts` — the real, working server that ships with Long Tail.

### The Skeleton

```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { loggerRegistry } from '../logger';

// ── Schemas ──────────────────────────────────────────────
// Extract schemas as top-level constants.
// This avoids TypeScript's TS2589 deep-instantiation error.

const navigateSchema = z.object({
  url: z.string().describe('URL to navigate to'),
  wait_until: z.enum(['load', 'domcontentloaded', 'networkidle']).optional(),
});

const screenshotSchema = z.object({
  path: z.string().describe('File path to save the PNG'),
  full_page: z.boolean().optional(),
  selector: z.string().optional(),
});
```

### Tool Registration

Tools are registered on the `McpServer` instance. Each tool has a name, metadata, and an async handler:

```typescript
function registerTools(srv: McpServer): void {
  (srv as any).registerTool(
    'navigate',
    {
      title: 'Navigate to URL',
      description: 'Open a URL in a new browser page.',
      inputSchema: navigateSchema,
    },
    async (args: z.infer<typeof navigateSchema>) => {
      const browser = await ensureBrowser();
      const page = await browser.newPage();
      await page.goto(args.url, { waitUntil: args.wait_until || 'load' });

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            page_id: 'page_1',
            url: args.url,
            title: await page.title(),
          }),
        }],
      };
    },
  );

  (srv as any).registerTool(
    'screenshot',
    {
      title: 'Take Screenshot',
      description: 'Capture a screenshot and save as PNG.',
      inputSchema: screenshotSchema,
    },
    async (args: z.infer<typeof screenshotSchema>) => {
      // ... implementation
    },
  );
}
```

**Response format** — always return `{ content: [{ type: 'text', text: JSON.stringify(...) }] }`. The MCP protocol requires this structure. For errors, add `isError: true` to the response object.

### The Factory Function

```typescript
export async function createPlaywrightServer(options?: {
  name?: string;
}): Promise<McpServer> {
  const name = options?.name || 'long-tail-playwright';
  const instance = new McpServer({ name, version: '1.0.0' });
  registerTools(instance);
  loggerRegistry.info(`[lt-mcp:playwright] ${name} ready (8 tools registered)`);
  return instance;
}
```

**Why a factory?** The MCP SDK allows only one transport per server instance. Each consumer (triage agent, test suite, CLI script) needs its own instance. The factory creates a fresh one each time; the `resolveClient` mechanism in `services/mcp/client.ts` handles caching.

### The Full Tool List

The Playwright server provides 8 tools:

| Tool | What It Does |
|------|-------------|
| `navigate` | Open a URL in a new browser page |
| `screenshot` | Capture page or element as PNG |
| `click` | Click an element by CSS selector |
| `fill` | Type into an input field |
| `wait_for` | Wait for an element to appear |
| `evaluate` | Run JavaScript in the page context |
| `list_pages` | List all open browser pages |
| `close_page` | Close a page by its ID |

---

## 3. Registering with Long Tail

### Step 1: Register the factory in `start.ts`

Find the block where builtin servers are registered (around line 210) and add yours:

```typescript
const { createPlaywrightServer } = await import('./services/mcp/playwright-server');
registerBuiltinServer('long-tail-playwright', createPlaywrightServer);
```

This tells `resolveClient()` how to auto-connect when any tool call targets `long-tail-playwright`.

### Step 2: Seed the tool manifest in `examples/index.ts`

Add an entry to `SEED_MCP_SERVERS` so the dashboard shows your server immediately:

```typescript
{
  name: 'long-tail-playwright',
  description: 'Browser automation via Playwright.',
  transport_type: 'stdio',
  transport_config: { builtin: true, process: 'in-memory' },
  tool_manifest: [
    { name: 'navigate', description: 'Open a URL in a new browser page.', inputSchema: { ... } },
    { name: 'screenshot', description: 'Capture a screenshot and save as PNG.', inputSchema: { ... } },
    // ... more tools
  ],
  metadata: { builtin: true, category: 'browser-automation' },
},
```

The `tool_manifest` array mirrors what `listTools()` returns from your server. It's pre-populated in the database so the triage agent's `getAvailableTools()` query finds them without needing a live connection first.

### That's It

After restart, your server appears in:
- **Dashboard → MCP Servers** (with all 8 tools listed)
- **Triage tool inventory** (LLM sees `long_tail_playwright__navigate`, etc.)
- **API** (`GET /api/mcp-servers`)

---

## 4. Testing Your Server

### Quick Smoke Test

Create a test script:

```typescript
// scripts/test-my-server.ts
import { createPlaywrightServer, stopPlaywrightServer } from '../services/mcp/playwright-server';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';

async function main() {
  // Create server + client linked via in-memory transport
  const server = await createPlaywrightServer({ name: 'test' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);

  const client = new Client({ name: 'test-client', version: '1.0.0' });
  await client.connect(clientTransport);

  // Discover tools
  const tools = await client.listTools();
  console.log('Tools:', tools.tools.map((t: any) => t.name));

  // Use a tool
  const result = await client.callTool({
    name: 'navigate',
    arguments: { url: 'https://example.com' },
  });
  console.log('Result:', (result as any).content[0].text);

  // Clean up
  await stopPlaywrightServer();
  await client.close();
}

main().catch(console.error);
```

Run it:

```bash
npx ts-node scripts/test-my-server.ts
```

```
[lt-mcp:playwright] test ready (8 tools registered)
Tools: [navigate, screenshot, click, fill, wait_for, evaluate, list_pages, close_page]
[lt-mcp:playwright] browser launched
Result: {"page_id":"page_1","url":"https://example.com","title":"Example Domain"}
[lt-mcp:playwright] browser closed
```

### Integration Test (vitest)

```typescript
import { describe, it, expect, afterAll } from 'vitest';
import { createPlaywrightServer, stopPlaywrightServer } from '../../services/mcp/playwright-server';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';

describe('Playwright MCP Server', () => {
  afterAll(async () => {
    await stopPlaywrightServer();
  });

  it('should navigate and take a screenshot', async () => {
    const server = await createPlaywrightServer({ name: 'test' });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await server.connect(st);
    const client = new Client({ name: 'test', version: '1.0.0' });
    await client.connect(ct);

    await client.callTool({
      name: 'navigate',
      arguments: { url: 'https://example.com' },
    });

    const result = await client.callTool({
      name: 'screenshot',
      arguments: { path: '/tmp/test-screenshot.png' },
    });

    const parsed = JSON.parse((result as any).content[0].text);
    expect(parsed.size_bytes).toBeGreaterThan(0);

    await client.close();
  }, 30_000);
});
```

---

## 5. Building Workflows That Use It

MCP tools are available to workflows through two paths:

### Path 1: Via the Triage Agent (Dynamic)

The triage agent automatically discovers your tools. When an escalation needs browser interaction, the LLM can call `long_tail_playwright__navigate`, `long_tail_playwright__screenshot`, etc. No workflow code needed — just trigger triage and describe the problem.

### Path 2: Via Custom Workflow Activities (Deterministic)

For workflows that always need browser access, call the tools directly from activities:

```typescript
// my-workflow/activities.ts
import * as mcpClient from '../../../services/mcp/client';

export async function capturePageScreenshot(
  url: string,
  outputPath: string,
): Promise<{ path: string; size_bytes: number }> {
  // Navigate
  await mcpClient.callServerTool('long-tail-playwright', 'navigate', { url });

  // Screenshot
  const result = await mcpClient.callServerTool('long-tail-playwright', 'screenshot', {
    path: outputPath,
    full_page: true,
  });

  return result;
}
```

Use it in your workflow:

```typescript
// my-workflow/index.ts
const { capturePageScreenshot } = Durable.workflow.proxyActivities<typeof activities>({
  activities,
});

export async function screenshotWorkflow(envelope: LTEnvelope) {
  const { url, outputDir } = envelope.data;
  const result = await capturePageScreenshot(url, `${outputDir}/page.png`);

  return {
    type: 'return' as const,
    data: { screenshot: result },
    milestones: [{ name: 'screenshot_captured', value: result.path }],
  };
}
```

---

## 6. Creating Custom Activities

Activities are the side-effect boundary in Long Tail. They're where you do I/O — call APIs, read databases, invoke MCP tools. HotMesh records the result and replays it deterministically on subsequent executions.

### The Pattern

```typescript
// examples/workflows/my-workflow/activities.ts

/**
 * Each exported function becomes a callable activity.
 * The function must be async and return serializable data.
 */
export async function myActivity(input: string): Promise<MyResult> {
  // Do something non-deterministic (API call, LLM, MCP tool, etc.)
  const result = await someExternalCall(input);
  return result;
}
```

### Activity Results with Milestones

Activities can return milestones for real-time dashboard updates:

```typescript
import type { LTActivity } from '../../../types';

export async function analyzeWithProgress(
  content: string,
): Promise<LTActivity<{ score: number }>> {
  const score = await llmAnalyze(content);

  return {
    type: 'activity',
    data: { score },
    milestones: [
      { name: 'llm_call', value: 'completed' },
      { name: 'score', value: score },
    ],
  };
}
```

The activity interceptor publishes these milestones to NATS in real-time. The dashboard picks them up via WebSocket.

### Using Activities in Workflows

```typescript
// examples/workflows/my-workflow/index.ts
import { Durable } from '@hotmeshio/hotmesh';
import * as activities from './activities';

// Proxy the activities — this routes execution to the activity worker
const { myActivity, analyzeWithProgress } =
  Durable.workflow.proxyActivities<typeof activities>({ activities });

export async function myWorkflow(envelope: LTEnvelope) {
  // These calls are recorded and replayed deterministically
  const result = await myActivity(envelope.data.input);
  const analysis = await analyzeWithProgress(envelope.data.content);

  return {
    type: 'return' as const,
    data: { result, analysis: analysis.data },
    milestones: analysis.milestones,
  };
}
```

---

## 7. The Full Workflow: Screenshot Capture

Here's a complete example: a workflow that navigates the Long Tail dashboard, logs in, captures screenshots of key pages, and saves them to `docs/img/`.

### Directory Structure

```
examples/workflows/capture-screenshots/
├── index.ts           # Deterministic workflow
├── activities.ts      # Browser automation via Playwright MCP
├── orchestrator.ts    # executeLT wrapper
```

### activities.ts

```typescript
import * as mcpClient from '../../../services/mcp/client';

const BASE_URL = process.env.LT_DASHBOARD_URL || 'http://localhost:3000';
const IMG_DIR = 'docs/img';

export async function navigateTo(path: string): Promise<{ page_id: string; title: string }> {
  const result = await mcpClient.callServerTool(
    'long-tail-playwright', 'navigate',
    { url: `${BASE_URL}${path}`, wait_until: 'networkidle' },
  );
  return result;
}

export async function login(username: string, password: string): Promise<void> {
  await mcpClient.callServerTool('long-tail-playwright', 'fill', {
    selector: 'input[name="username"]', value: username,
  });
  await mcpClient.callServerTool('long-tail-playwright', 'fill', {
    selector: 'input[name="password"]', value: password,
  });
  await mcpClient.callServerTool('long-tail-playwright', 'click', {
    selector: 'button[type="submit"]',
  });
  await mcpClient.callServerTool('long-tail-playwright', 'wait_for', {
    selector: '[data-testid="dashboard"]', timeout: 10000,
  });
}

export async function captureScreenshot(
  name: string,
  fullPage?: boolean,
): Promise<{ path: string; size_bytes: number }> {
  return await mcpClient.callServerTool('long-tail-playwright', 'screenshot', {
    path: `${IMG_DIR}/${name}.png`,
    full_page: fullPage ?? false,
  });
}

export async function closeBrowser(): Promise<void> {
  const { stopPlaywrightServer } = await import('../../../services/mcp/playwright-server');
  await stopPlaywrightServer();
}
```

### index.ts

```typescript
import { Durable } from '@hotmeshio/hotmesh';
import type { LTEnvelope } from '../../../types';
import * as activities from './activities';

const { navigateTo, login, captureScreenshot, closeBrowser } =
  Durable.workflow.proxyActivities<typeof activities>({ activities });

export async function captureScreenshots(envelope: LTEnvelope) {
  const screenshots: string[] = [];

  try {
    // Login page
    await navigateTo('/login');
    await captureScreenshot('01-login-page');
    screenshots.push('01-login-page.png');

    // Log in
    await login('superadmin', 'superadmin123');
    await captureScreenshot('02-dashboard-home');
    screenshots.push('02-dashboard-home.png');

    // Processes
    await navigateTo('/processes');
    await captureScreenshot('03-processes-list');
    screenshots.push('03-processes-list.png');

    // Escalations
    await navigateTo('/escalations');
    await captureScreenshot('04-escalations-list');
    screenshots.push('04-escalations-list.png');

    // MCP Servers
    await navigateTo('/mcp-servers');
    await captureScreenshot('05-mcp-servers');
    screenshots.push('05-mcp-servers.png');
  } finally {
    await closeBrowser();
  }

  return {
    type: 'return' as const,
    data: { screenshots, count: screenshots.length },
    milestones: [
      { name: 'screenshots_captured', value: screenshots.length },
    ],
  };
}
```

### orchestrator.ts

```typescript
import { executeLT } from '../../../orchestrator';
import type { LTEnvelope } from '../../../types';

export async function captureScreenshotsOrchestrator(envelope: LTEnvelope) {
  return await executeLT({
    workflowName: 'captureScreenshots',
    args: [envelope],
    taskQueue: 'lt-screenshots',
  });
}
```

This workflow doesn't exist yet in the codebase — it's a blueprint. The key insight: the triage agent can do exactly the same thing *without* a pre-built workflow, by calling the same Playwright MCP tools in its agentic loop. The workflow just makes it deterministic and repeatable.

---

## 8. From Triage to YAML: Hardening the Fix

Here's how a triage execution using your MCP server becomes a permanent workflow:

### 1. Triage Runs

An escalation triggers triage. The LLM discovers your tools via `getAvailableTools()`:

```
Available tools:
  long_tail_playwright__navigate
  long_tail_playwright__screenshot
  long_tail_playwright__click
  long_tail_playwright__fill
  ...
```

The LLM calls them in sequence to solve the problem.

### 2. Compile the Execution

After triage succeeds, extract its tool call sequence into a YAML workflow:

```bash
POST /api/yaml-workflows
{
  "workflow_id": "<triage_workflow_id>",
  "task_queue": "lt-mcp-triage",
  "workflow_name": "mcpTriage",
  "name": "capture-dashboard-screenshots",
  "description": "Navigate dashboard pages and capture screenshots"
}
```

The generator analyzes the execution events, extracts the tool call sequence, and strips all LLM reasoning:

```
Triage execution:
  LLM thinks → navigate('/login')
  LLM thinks → fill('input[name=username]', 'admin')
  LLM thinks → click('button[type=submit]')
  LLM thinks → screenshot('docs/img/dashboard.png')

Compiled YAML:
  navigate → fill → click → screenshot
  (no LLM, direct data piping)
```

### 3. Deploy and Activate

```bash
POST /api/yaml-workflows/<id>/deploy   { "activate": true }
```

### 4. Future Invocations

The compiled workflow is now available as an MCP tool itself:

```
long_tail_mcp_workflows__invoke_workflow
  workflow_name: "capture-dashboard-screenshots"
```

The next triage run that needs screenshots will find this compiled workflow first and invoke it directly — 0 LLM calls, deterministic, instant.

---

## 9. Your Own MCP Server: A Template

Copy this template and fill in the blanks:

```typescript
// services/mcp/my-custom-server.ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { loggerRegistry } from '../logger';

// ── Schemas ──────────────────────────────────────────────

const myToolSchema = z.object({
  input: z.string().describe('What this tool needs'),
});

// ── Tool registration ────────────────────────────────────

function registerTools(srv: McpServer): void {
  (srv as any).registerTool(
    'my_tool',
    {
      title: 'My Tool',
      description: 'What it does — be specific, the LLM reads this.',
      inputSchema: myToolSchema,
    },
    async (args: z.infer<typeof myToolSchema>) => {
      // Your implementation here
      const result = { processed: args.input };

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify(result),
        }],
      };
    },
  );
}

// ── Factory ──────────────────────────────────────────────

export async function createMyCustomServer(options?: {
  name?: string;
}): Promise<McpServer> {
  const name = options?.name || 'long-tail-my-custom';
  const instance = new McpServer({ name, version: '1.0.0' });
  registerTools(instance);
  loggerRegistry.info(`[lt-mcp:my-custom] ${name} ready`);
  return instance;
}

export async function stopMyCustomServer(): Promise<void> {
  // Clean up resources if needed
  loggerRegistry.info('[lt-mcp:my-custom] stopped');
}
```

### Registration Checklist

1. **Create** `services/mcp/my-custom-server.ts`
2. **Register factory** in `start.ts`:
   ```typescript
   const { createMyCustomServer } = await import('./services/mcp/my-custom-server');
   registerBuiltinServer('long-tail-my-custom', createMyCustomServer);
   ```
3. **Seed manifest** in `examples/index.ts` (add to `SEED_MCP_SERVERS`)
4. **Restart** — tools appear in dashboard and triage agent

---

## 10. Ideas: What to Wrap Next

The pattern works for anything. Here are ideas for MCP servers that would expand the triage agent's capabilities:

| Server | Tools | Use Case |
|--------|-------|----------|
| **S3/GCS Storage** | `upload_file`, `download_file`, `list_files` | Store screenshots, rotated images, generated reports in cloud storage instead of local filesystem |
| **Slack/Teams** | `send_message`, `create_channel`, `upload_file` | Notify teams when triage completes, share screenshots, post escalation summaries |
| **PDF Generator** | `html_to_pdf`, `merge_pdfs`, `extract_text` | Generate reports from workflow data, merge claim documents |
| **Email** | `send_email`, `create_draft` | Notify stakeholders, send resolution summaries |
| **GitHub** | `create_issue`, `create_pr`, `add_comment` | Auto-file bugs from triage recommendations, track remediation |
| **Jira/Linear** | `create_ticket`, `update_status` | Sync escalations with project management tools |
| **Redis/Cache** | `get`, `set`, `invalidate` | Cache expensive LLM results, share state between triage runs |
| **Metrics** | `record_metric`, `query_dashboard` | Track triage success rates, tool usage patterns |

Each one follows the same pattern:

1. Create `services/mcp/my-server.ts` with factory + tools
2. Register in `start.ts`
3. Seed manifest in `examples/index.ts`
4. The triage agent discovers it automatically

The compound effect is powerful. Every new server expands what the triage agent can do. Every successful triage gets compiled into a YAML workflow. Every compiled workflow makes the next triage faster. The system accumulates capability over time — the opposite of entropy.

---

## Appendix: The Playwright Server Source

The full source lives at `services/mcp/playwright-server.ts`. Key implementation details:

- **Lazy browser launch** — Chromium starts on the first `navigate` call, not at server creation
- **Page management** — Each `navigate` creates a new page with an auto-incrementing ID. Tools default to the most recent page if no `page_id` is specified
- **Directory creation** — `screenshot` auto-creates output directories with `{ recursive: true }`
- **Error resilience** — Missing elements return structured errors (not thrown exceptions) so the LLM can adapt
- **Clean shutdown** — `stopPlaywrightServer()` closes all pages and the browser

Install Playwright if not already present:

```bash
npm install playwright
npx playwright install chromium
```

The server requires only the `chromium` browser. Firefox and WebKit are not installed by default.
