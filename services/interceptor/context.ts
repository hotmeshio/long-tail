import { AsyncLocalStorage } from 'async_hooks';

export interface OrchestratorContext {
  workflowId: string;
  taskQueue: string;
  workflowType: string;
}

const store = new AsyncLocalStorage<OrchestratorContext>();

/**
 * Run a function with orchestrator context available via `getOrchestratorContext()`.
 * Called by the interceptor when wrapping a container/orchestrator workflow.
 */
export function runWithOrchestratorContext<T>(
  ctx: OrchestratorContext,
  fn: () => Promise<T>,
): Promise<T> {
  return store.run(ctx, fn);
}

/**
 * Retrieve the orchestrator context set by the interceptor.
 * Called by `executeLT` to inject parent routing into child envelopes.
 */
export function getOrchestratorContext(): OrchestratorContext | undefined {
  return store.getStore();
}
