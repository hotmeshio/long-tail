/** Type definitions for the orchestrator service. */

export interface ExecuteLTOptions {
  /** Name of the child workflow function to execute */
  workflowName: string;
  /** Arguments to pass to the child workflow */
  args: any[];
  /** Task queue the child workflow is registered on */
  taskQueue: string;
  /** Explicit child workflow ID (auto-generated if omitted) */
  workflowId?: string;
  /** TTL in seconds for the child workflow */
  expire?: number;
  /** Correlation ID for provider data lookups across sibling tasks */
  originId?: string;
}
