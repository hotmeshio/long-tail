/**
 * ToolContext access for activities and workflow-scoped code.
 *
 * Two paths, checked in order:
 *
 * 1. **headers** (production-safe, distributed):
 *    The activity interceptor injects `principal` + `scopes` into
 *    `headers`, which HotMesh delivers to the activity worker
 *    via `Durable.activity.getContext()`. Works across process boundaries.
 *
 * 2. **AsyncLocalStorage** (workflow-local, single-process):
 *    The workflow interceptor wraps `next()` with `runWithToolContext()`
 *    for code running in the workflow's own async scope (e.g., MCP server
 *    tools called directly, not via proxy activities).
 */
import { AsyncLocalStorage } from 'async_hooks';
import { Durable } from '@hotmeshio/hotmesh';

import type { ToolContext, ToolPrincipal } from '../../types/tool-context';

const store = new AsyncLocalStorage<ToolContext>();

/**
 * Run a function with ToolContext available via `getToolContext()`.
 * Called by the interceptor to wrap workflow execution.
 */
export function runWithToolContext<T>(
  ctx: ToolContext,
  fn: () => Promise<T>,
): Promise<T> {
  return store.run(ctx, fn);
}

/**
 * Retrieve the ToolContext for the current execution scope.
 *
 * Activities: reads from headers (injected by activity interceptor).
 * Workflow scope: reads from AsyncLocalStorage (set by workflow interceptor).
 * Returns undefined when no identity is available.
 */
export function getToolContext(): ToolContext | undefined {
  // 1. Try headers (activity worker — works distributed)
  try {
    const actCtx = Durable.activity.getContext();
    const meta = actCtx?.headers;
    if (meta?.principal) {
      const principal = meta.principal as ToolPrincipal;
      return {
        principal,
        ...(meta.initiatingPrincipal
          ? { initiatingPrincipal: meta.initiatingPrincipal as ToolPrincipal }
          : {}),
        credentials: {
          scopes: (meta.scopes as string[]) ?? [],
        },
        trace: {},
      };
    }
  } catch {
    // Not inside an activity execution — fall through
  }

  // 2. Fallback: AsyncLocalStorage (workflow-local scope)
  return store.getStore();
}
