# Create an MCP Server

We needed screenshots for our QA documentation. Taking them by hand was slow, and they went stale every time the UI changed. So we built an MCP server that wraps Playwright — now the system can navigate the dashboard, capture screenshots, and update the docs automatically.

This is the story of how we built it, and a guide for building your own.

Long Tail ships with a Playwright MCP Server. The screenshots in the [QA Manual](qa-manual.md) were generated using it.

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

The screenshot problem gave us a clear spec: navigate the dashboard, fill in a login form, click through pages, and save PNGs. Playwright does all of that. The question was how to expose it so the triage agent (or a curl script, or a workflow) could use it without knowing anything about Playwright's API.

The answer: wrap it in an MCP server. Here's `services/mcp/playwright-server.ts` — the real, working server that ships with Long Tail.

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

The Playwright server provides 8 tools. These are the building blocks we used to solve the screenshot problem — and the same tools available to any workflow or triage agent:

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

### Path 3: Via the REST API (Scripts and CI)

There's a third path that doesn't require writing any workflow code at all: call the MCP server's tools directly through the Long Tail REST API. This is how we actually generated the screenshots for the QA manual, and it's the approach Section 7 walks through in detail.

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

This is where the story comes full circle. We needed 10 screenshots for `docs/qa-manual.md` — login page, dashboard home, processes list, escalation views, MCP servers, pipelines, workflows, tasks, and detail pages. Taking them by hand meant logging in, navigating to each page, resizing the window, hitting Cmd+Shift+4, naming the file, and repeating. Every time we changed the UI, every screenshot went stale.

Here's exactly how we solved it.

### What We Did

The Playwright MCP server runs inside the Docker container. Long Tail exposes every registered MCP tool through a REST endpoint: `POST /api/mcp/servers/:serverId/tools/:toolName/call`. So generating screenshots became a sequence of curl calls — authenticate, navigate, fill, click, screenshot, repeat.

The actual session that produced the screenshots in the QA manual looked like this:

#### Step 1: Get an auth token

```bash
TOKEN=$(curl -s http://localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"superadmin","password":"superadmin123"}' | jq -r '.token')
```

#### Step 2: Find the Playwright server ID

```bash
PW_ID=$(curl -s http://localhost:3000/api/mcp-servers \
  -H "Authorization: Bearer $TOKEN" \
  | jq -r '.servers[] | select(.name=="long-tail-playwright") | .id')
```

#### Step 3: Navigate to the login page and screenshot it

```bash
# Navigate opens a new browser page
curl -s "http://localhost:3000/api/mcp/servers/$PW_ID/tools/navigate/call" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"arguments":{"url":"http://localhost:3000/login","wait_until":"networkidle"}}'

# Capture the login page
curl -s "http://localhost:3000/api/mcp/servers/$PW_ID/tools/screenshot/call" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"arguments":{"path":"/app/docs/img/01-login.png"}}'
```

#### Step 4: Log in through the form

```bash
# Fill username
curl -s "http://localhost:3000/api/mcp/servers/$PW_ID/tools/fill/call" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"arguments":{"selector":"#username","value":"superadmin"}}'

# Fill password
curl -s "http://localhost:3000/api/mcp/servers/$PW_ID/tools/fill/call" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"arguments":{"selector":"#password","value":"superadmin123"}}'

# Click submit
curl -s "http://localhost:3000/api/mcp/servers/$PW_ID/tools/click/call" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"arguments":{"selector":"button[type=\"submit\"]"}}'

# Wait for the dashboard to load
curl -s "http://localhost:3000/api/mcp/servers/$PW_ID/tools/wait_for/call" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"arguments":{"selector":"nav","timeout":10000}}'

# Screenshot the dashboard home
curl -s "http://localhost:3000/api/mcp/servers/$PW_ID/tools/screenshot/call" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"arguments":{"path":"/app/docs/img/02-dashboard-home.png","page_id":"page_7"}}'
```

#### Step 5: Navigate through the SPA (the key insight)

Here's a gotcha we hit. The `navigate` tool opens a **new** browser page every time it's called. That new page has no cookies — so it lands on the login screen instead of the page you asked for. After logging in once, we needed to stay on the same page and navigate within the SPA.

The solution: use `evaluate` to set `window.location.href`. This navigates the **existing** page, preserving the auth cookies and session state.

```bash
# SPA-navigate to Processes (preserves auth cookies)
curl -s "http://localhost:3000/api/mcp/servers/$PW_ID/tools/evaluate/call" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"arguments":{"script":"window.location.href = \"/processes/list\"; \"ok\"","page_id":"page_7"}}'

# Wait for the page to settle
curl -s "http://localhost:3000/api/mcp/servers/$PW_ID/tools/wait_for/call" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"arguments":{"selector":"table","timeout":10000,"page_id":"page_7"}}'

# Screenshot
curl -s "http://localhost:3000/api/mcp/servers/$PW_ID/tools/screenshot/call" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"arguments":{"path":"/app/docs/img/03-processes-list.png","page_id":"page_7"}}'
```

We repeated this `evaluate` → `wait_for` → `screenshot` pattern for every page:

| Screenshot | SPA Route | File |
|-----------|-----------|------|
| Login page | `/login` | `01-login.png` |
| Dashboard home | (after login) | `02-dashboard-home.png` |
| Processes list | `/processes/list` | `03-processes-list.png` |
| Escalations list | `/escalations/available` | `04-escalations-list.png` |
| MCP Servers | `/mcp/servers` | `05-mcp-servers.png` |
| Process Servers | `/mcp/pipelines` | `06-mcp-pipelines.png` |
| Workflows overview | `/workflows` | `07-workflows-list.png` |
| Tasks list | `/workflows/tasks` | `08-tasks-list.png` |
| Process detail | `/processes/detail/:originId` | `09-process-detail.png` |
| Escalation detail | `/escalations/detail/:id` | `10-escalation-detail.png` |

### The Docker Path Gotcha

Notice the screenshot paths use `/app/docs/img/` — not `docs/img/`. Playwright runs inside the Docker container where the project root is `/app`. The `docker-compose.yml` maps the host directory into the container with a volume mount (`.:/app`), so `/app/docs/img/03-processes-list.png` inside the container appears as `docs/img/03-processes-list.png` on the host.

If you're running outside Docker, use relative paths from your project root instead.

### The Workflow Blueprint

The curl approach works well for scripts and CI. But you can also encode the same logic as a durable workflow. Here's a blueprint — it doesn't exist in the codebase yet, but it follows the same patterns used by every other workflow in `examples/workflows/`:

#### Directory Structure

```
examples/workflows/capture-screenshots/
├── index.ts           # Deterministic workflow
├── activities.ts      # Browser automation via Playwright MCP
├── orchestrator.ts    # executeLT wrapper
```

#### activities.ts

```typescript
import * as mcpClient from '../../../services/mcp/client';

const BASE_URL = process.env.LT_DASHBOARD_URL || 'http://localhost:3000';
const IMG_DIR = '/app/docs/img';

export async function navigateTo(url: string): Promise<{ page_id: string; title: string }> {
  const result = await mcpClient.callServerTool(
    'long-tail-playwright', 'navigate',
    { url, wait_until: 'networkidle' },
  );
  return result;
}

export async function spaNavigate(
  path: string,
  pageId: string,
): Promise<void> {
  // Use evaluate to navigate within the SPA, preserving auth cookies
  await mcpClient.callServerTool('long-tail-playwright', 'evaluate', {
    script: `window.location.href = "${path}"; "ok"`,
    page_id: pageId,
  });
  // Wait for content to settle
  await mcpClient.callServerTool('long-tail-playwright', 'wait_for', {
    selector: 'main',
    timeout: 10000,
    page_id: pageId,
  });
}

export async function login(username: string, password: string): Promise<void> {
  await mcpClient.callServerTool('long-tail-playwright', 'fill', {
    selector: '#username', value: username,
  });
  await mcpClient.callServerTool('long-tail-playwright', 'fill', {
    selector: '#password', value: password,
  });
  await mcpClient.callServerTool('long-tail-playwright', 'click', {
    selector: 'button[type="submit"]',
  });
  await mcpClient.callServerTool('long-tail-playwright', 'wait_for', {
    selector: 'nav', timeout: 10000,
  });
}

export async function captureScreenshot(
  name: string,
  pageId: string,
  fullPage?: boolean,
): Promise<{ path: string; size_bytes: number }> {
  return await mcpClient.callServerTool('long-tail-playwright', 'screenshot', {
    path: `${IMG_DIR}/${name}.png`,
    full_page: fullPage ?? false,
    page_id: pageId,
  });
}

export async function closeBrowser(): Promise<void> {
  const { stopPlaywrightServer } = await import('../../../services/mcp/playwright-server');
  await stopPlaywrightServer();
}
```

#### index.ts

```typescript
import { Durable } from '@hotmeshio/hotmesh';
import type { LTEnvelope } from '../../../types';
import * as activities from './activities';

const { navigateTo, spaNavigate, login, captureScreenshot, closeBrowser } =
  Durable.workflow.proxyActivities<typeof activities>({ activities });

export async function captureScreenshots(envelope: LTEnvelope) {
  const screenshots: string[] = [];

  try {
    // Navigate to login (opens a new page)
    const { page_id } = await navigateTo('http://localhost:3000/login');
    await captureScreenshot('01-login', page_id);
    screenshots.push('01-login.png');

    // Log in through the form
    await login('superadmin', 'superadmin123');
    await captureScreenshot('02-dashboard-home', page_id);
    screenshots.push('02-dashboard-home.png');

    // SPA-navigate to each page (preserves session)
    const pages = [
      { route: '/processes/list',       name: '03-processes-list' },
      { route: '/escalations/available', name: '04-escalations-list' },
      { route: '/mcp/servers',           name: '05-mcp-servers' },
      { route: '/mcp/pipelines',         name: '06-mcp-pipelines' },
      { route: '/workflows/list',        name: '07-workflows-list' },
      { route: '/tasks/list',            name: '08-tasks-list' },
    ];

    for (const { route, name } of pages) {
      await spaNavigate(route, page_id);
      await captureScreenshot(name, page_id);
      screenshots.push(`${name}.png`);
    }
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

#### orchestrator.ts

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

Both paths — the curl scripts and the durable workflow — use the same underlying Playwright MCP tools. The curl approach is immediate and good for one-off runs or CI scripts. The workflow approach adds durability, retries, and milestone tracking. Choose whichever fits your use case.

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

### Docker and Playwright

The Long Tail Docker image uses `node:20-slim` (Debian) rather than `node:20-alpine`. This is a deliberate choice: Playwright's Chromium requires glibc and a set of system libraries that Alpine Linux doesn't provide. The Dockerfile installs these dependencies and downloads the Chromium binary during the image build:

```dockerfile
FROM node:20-slim AS base

# System deps for Playwright Chromium
RUN apt-get update && apt-get install -y --no-install-recommends \
    libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
    libxcomposite1 libxdamage1 libxrandr2 libgbm1 libpango-1.0-0 \
    libcairo2 libasound2 libxshmfence1 libx11-xcb1 libxcb1 \
    libxfixes3 libxkbcommon0 \
    fonts-liberation fonts-noto-color-emoji ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci
RUN npx playwright install chromium
```

If you're running outside Docker, install Playwright locally:

```bash
npm install playwright
npx playwright install chromium
```

The server requires only the `chromium` browser. Firefox and WebKit are not installed by default.

### Builtin Server Connection

When the dashboard's "Connect" button is clicked for a builtin server, `connectToServer()` detects `transport_config.builtin: true` and uses `InMemoryTransport` to link the factory-created server instance with a client — no external processes, no ports. The Chromium browser itself is lazy-launched on the first `navigate` call, not at connection time.
