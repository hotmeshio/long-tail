/**
 * AsyncLocalStorage-based ToolContext propagation.
 *
 * The interceptor calls `runWithToolContext()` to make identity
 * available to all activities in the workflow execution scope.
 * Activities call `getToolContext()` regardless of invocation path.
 */
import { AsyncLocalStorage } from 'async_hooks';

import type { ToolContext } from '../../types/tool-context';

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
 * Retrieve the ToolContext set by the interceptor.
 * Returns undefined when called outside a workflow execution scope
 * (e.g., direct route handler without interceptor wrapping).
 */
export function getToolContext(): ToolContext | undefined {
  return store.getStore();
}
