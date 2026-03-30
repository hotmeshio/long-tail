/**
 * Workflow state export types.
 *
 * Raw export types wrap the HotMesh DurableJobExport model with LT-specific
 * naming so consumers never couple directly to the engine layer.
 *
 * Execution types are re-exported directly from HotMesh's native
 * Temporal-compatible format (added in 0.10.2).
 */

// ── Re-export HotMesh native execution types ────────────────────────────────

export type {
  WorkflowExecution,
  WorkflowExecutionEvent,
  WorkflowExecutionStatus,
  WorkflowExecutionSummary,
  WorkflowEventType,
  WorkflowEventCategory,
  WorkflowEventAttributes,
  ExecutionExportOptions,
  ExportMode,
  ActivityDetail,
  JobExport,
  // Attribute variants (discriminated union via `kind`)
  WorkflowExecutionStartedAttributes,
  WorkflowExecutionCompletedAttributes,
  WorkflowExecutionFailedAttributes,
  ActivityTaskScheduledAttributes,
  ActivityTaskCompletedAttributes,
  ActivityTaskFailedAttributes,
  ChildWorkflowExecutionStartedAttributes,
  ChildWorkflowExecutionCompletedAttributes,
  ChildWorkflowExecutionFailedAttributes,
  TimerStartedAttributes,
  TimerFiredAttributes,
  WorkflowExecutionSignaledAttributes,
} from '@hotmeshio/hotmesh/build/types/exporter';

// ── Raw export field selection ──────────────────────────────────────────────

/**
 * Facets available in a workflow export.
 * Mirrors HotMesh ExportFields.
 */
export type LTExportField = 'data' | 'state' | 'status' | 'timeline' | 'transitions';

/**
 * Options for controlling which facets are included in an export.
 *
 * - `allow` — whitelist: only these facets are returned.
 * - `block` — blacklist: all facets *except* these are returned.
 * - `values` — when false, timeline entries omit their value payloads
 *   (useful for reducing transfer size).
 *
 * If neither `allow` nor `block` is supplied every facet is included.
 */
export interface LTExportOptions {
  allow?: LTExportField[];
  block?: LTExportField[];
  values?: boolean;
  enrich_inputs?: boolean;
}

// ── Timeline & transitions ─────────────────────────────────────────────────

/**
 * A single entry in the workflow activity timeline.
 * Each entry represents an activity execution with its index
 * position in the execution graph.
 */
export interface LTTimelineEntry {
  key: string;
  value: Record<string, any> | string | number | null;
  index: number;
  secondary?: number;
  dimension?: string;
}

/**
 * A single state transition in the workflow execution.
 * Tracks which activity moved through which dimension and when.
 */
export interface LTTransitionEntry {
  activity: string;
  dimensions: string;
  created: string;
  updated: string;
}

// ── Top-level raw export record ────────────────────────────────────────────

/**
 * Full workflow state export (raw HotMesh format).
 *
 * Returned by the export service and the
 * `GET /api/workflow-states/:workflowId` endpoint.
 *
 * Facets are optional because callers may use `allow` / `block`
 * to restrict the response.
 */
export interface LTWorkflowExport {
  /** The workflow ID this export belongs to. */
  workflow_id: string;
  /** Input/output data stored during execution. */
  data?: Record<string, any>;
  /** Job state hash — current key/value pairs. */
  state?: Record<string, any>;
  /** Numeric status semaphore (positive = complete, 0 = pending, negative = interrupted). */
  status?: number;
  /** Ordered activity execution timeline. */
  timeline?: LTTimelineEntry[];
  /** Activity state transitions in chronological order. */
  transitions?: LTTransitionEntry[];
  /** Structured per-activity details with input/output (requires enrich_inputs). */
  activities?: import('@hotmeshio/hotmesh/build/types/exporter').ActivityDetail[];
}
