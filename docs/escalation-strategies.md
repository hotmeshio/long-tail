# Escalation Strategies

By default, when a human resolves an escalation, Long Tail re-runs the original workflow with the resolver's payload. This is the deterministic path — it always works, it's predictable, and it covers most cases.

But sometimes the human *can't* fix the problem. An upside-down page. A corrupted image. A document in the wrong language. The resolver knows what's wrong but can't produce the correct data themselves. They need the system to remediate and retry.

Escalation strategies are the pluggable layer that decides what happens when a resolution arrives. The default strategy re-runs. The MCP strategy can route to a triage orchestrator that calls tools, fixes the problem, and re-invokes the original workflow with corrected data.

## Contents

- [How It Works](#how-it-works)
- [The Default Strategy](#the-default-strategy)
- [The MCP Strategy](#the-mcp-strategy)
- [The `_lt` Namespace](#the-_lt-namespace)
- [The Triage Orchestrator](#the-triage-orchestrator)
- [Writing a Custom Strategy](#writing-a-custom-strategy)
- [Configuration](#configuration)
- [Testing](#testing)

## How It Works

When `POST /api/escalations/:id/resolve` is called, the resolution route checks the registered escalation strategy before starting a re-run. The strategy returns a directive:

```
Resolver payload arrives
        │
        ▼
┌───────────────────┐
│ Escalation        │
│ Strategy          │
│                   │
│ onResolution()    │──── { action: 'rerun' }  ──── Standard re-run
│                   │
│                   │──── { action: 'triage' } ──── MCP triage orchestrator
└───────────────────┘
```

The strategy sees the full context: the escalation record, the resolver's payload, and the original envelope. It decides whether to re-run or triage.

## The Default Strategy

Always returns `{ action: 'rerun' }`. This is today's behavior — the resolver's payload is injected into `envelope.resolver` and the original workflow runs again. The workflow checks `if (envelope.resolver)` and returns the human's decision.

This is the default when no strategy is configured or when `escalation.strategy` is `'default'`.

## The MCP Strategy

Checks `resolverPayload._lt.needsTriage`. If the resolver flagged the escalation for triage, the strategy builds a triage envelope and returns `{ action: 'triage' }`. If not, it falls through to `{ action: 'rerun' }`.

The triage envelope contains everything the triage orchestrator needs:

```typescript
{
  data: {
    escalationId,
    originId,
    originalWorkflowType,
    originalTaskQueue,
    originalTaskId,
    escalationPayload,   // what the workflow reported
    resolverPayload,     // what the human said
  },
  metadata: { ... },
  lt: { ... },
}
```

## The `_lt` Namespace

The `_lt` key in resolver payloads is reserved for Long Tail control flow. Resolvers use it to communicate routing hints:

| Field | Type | Description |
|-------|------|-------------|
| `_lt.needsTriage` | `boolean` | Route to triage orchestrator instead of standard re-run |
| `_lt.hint` | `string` | Remediation hint for the triage orchestrator (e.g., `'image_orientation'`) |

Everything outside `_lt` is the resolver's domain-specific data. The strategy reads `_lt` to decide routing; the triage orchestrator reads `_lt.hint` to decide which tools to call.

Example resolution with triage:

```json
{
  "resolverPayload": {
    "_lt": {
      "needsTriage": true,
      "hint": "image_orientation"
    },
    "notes": "Page 1 is upside down, cannot extract data"
  }
}
```

Example resolution without triage (standard re-run):

```json
{
  "resolverPayload": {
    "memberId": "MBR-2024-001",
    "verified": true,
    "notes": "Address updated in system"
  }
}
```

## The Triage Orchestrator

When the MCP strategy routes to triage, the system:

1. Creates a task record for the triage orchestrator with the original parent's routing metadata
2. Starts the `mcpTriageOrchestrator` workflow
3. Marks the escalation as resolved (triage is handling it)

The triage orchestrator (`mcpTriageOrchestrator`) is a container that calls the `mcpTriage` workflow via `executeLT`. The triage workflow:

1. **Queries upstream tasks** — reads all tasks sharing the same `originId` to understand what happened before
2. **Reads the resolver hint** — `_lt.hint` tells it what kind of remediation is needed
3. **Calls MCP tools** — based on the hint, calls the appropriate tools:
   - `image_orientation` → lists document pages, calls `rotate_page` for each
4. **Re-invokes the original workflow** — starts the failed workflow again with corrected data (e.g., rotated page references)
5. **Signals back** — the re-invoked workflow succeeds, and the interceptor signals through standard channels back to the original parent orchestrator

The full chain:

```
Orchestrator waits ──► Child workflow escalates
                              │
                       Human says needsTriage
                              │
                       MCP triage orchestrator
                              │
                       Queries upstream tasks
                       Calls MCP tools (rotate_page, etc.)
                       Re-invokes original workflow with corrected data
                              │
                       Original workflow succeeds
                              │
                       Signals back to original orchestrator
                              │
                       Orchestrator resumes ◄──
```

### Available MCP Tools

The Vision MCP server provides tools that the triage orchestrator can call:

| Tool | Description |
|------|-------------|
| `list_document_pages` | List available document page images |
| `extract_member_info` | Extract member info from a page (Vision API) |
| `validate_member` | Validate extracted info against the database |
| `rotate_page` | Rotate a page image by 90/180/270 degrees |

## Writing a Custom Strategy

Implement the `LTEscalationStrategy` interface:

```typescript
import type { LTEscalationStrategy, ResolutionContext, ResolutionDirective } from '@hotmeshio/long-tail';

export class MyStrategy implements LTEscalationStrategy {
  async onResolution(context: ResolutionContext): Promise<ResolutionDirective> {
    const { escalation, resolverPayload, envelope } = context;

    // Your routing logic here
    if (shouldTriage(resolverPayload)) {
      return {
        action: 'triage',
        triageEnvelope: buildTriageEnvelope(context),
      };
    }

    return { action: 'rerun' };
  }
}
```

Register it at startup:

```typescript
import { escalationStrategyRegistry } from '@hotmeshio/long-tail';
import { MyStrategy } from './my-strategy';

escalationStrategyRegistry.register(new MyStrategy());
```

Or use the `start()` config:

```typescript
await start({
  database: { ... },
  workers: [ ... ],
  escalation: {
    adapter: new MyStrategy(),
  },
});
```

## Configuration

### Via `start()` config

```typescript
// Default strategy (always rerun)
await start({
  database: { ... },
  workers: [ ... ],
});

// MCP strategy (supports triage when needsTriage is set)
await start({
  database: { ... },
  workers: [ ... ],
  escalation: {
    strategy: 'mcp',
  },
});

// Custom adapter
await start({
  database: { ... },
  workers: [ ... ],
  escalation: {
    adapter: new MyCustomStrategy(),
  },
});
```

### Programmatic registration

```typescript
import { escalationStrategyRegistry, McpEscalationStrategy } from '@hotmeshio/long-tail';

escalationStrategyRegistry.register(new McpEscalationStrategy());
```

When the MCP strategy is configured, ensure the triage workers are registered:

```typescript
import * as mcpTriageWorkflow from '@hotmeshio/long-tail/workflows/mcp-triage';
import * as mcpTriageOrchWorkflow from '@hotmeshio/long-tail/workflows/mcp-triage/orchestrator';

await start({
  database: { ... },
  workers: [
    // ... your workflows
    { taskQueue: 'lt-mcp-triage', workflow: mcpTriageWorkflow.mcpTriage },
    { taskQueue: 'lt-mcp-triage-orch', workflow: mcpTriageOrchWorkflow.mcpTriageOrchestrator },
  ],
  escalation: { strategy: 'mcp' },
});
```

## Testing

The MCP triage test demonstrates the full flow without requiring an OpenAI API key. It uses mock activities with deterministic extraction:

```bash
# Run the triage test
npx vitest run tests/workflows/mcp-triage.test.ts --reporter=verbose
```

The test covers:
1. **Full triage flow** — extraction fails, human flags `needsTriage`, triage orchestrator rotates pages, re-invoked workflow succeeds, signals back to parent
2. **Standard fallback** — resolver doesn't set `needsTriage`, standard re-run proceeds as normal
