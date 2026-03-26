/**
 * Type definitions for the YAML workflow service.
 *
 * Includes types for the database layer, the 5-stage compilation pipeline
 * (extract → analyze → compile → build → validate), and the DAG builder.
 */

import type { ActivityManifestEntry, InputFieldMeta } from '../../types/yaml-workflow';
import type { WorkflowExecution } from '../../types';
import type { PatternAnnotation } from './pattern-detector';

// ── Database layer ───────────────────────────────────────────────────────────

export interface CreateYamlWorkflowInput {
  name: string;
  description?: string;
  app_id: string;
  app_version?: string;
  source_workflow_id?: string;
  source_workflow_type?: string;
  yaml_content: string;
  graph_topic: string;
  input_schema?: Record<string, unknown>;
  output_schema?: Record<string, unknown>;
  activity_manifest?: ActivityManifestEntry[];
  input_field_meta?: InputFieldMeta[];
  original_prompt?: string;
  category?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

// ── Build stage ──────────────────────────────────────────────────────────────

/** Mutable state accumulated while building the YAML DAG. */
export interface DagBuilder {
  activities: Record<string, unknown>;
  transitions: Record<string, Array<{ to: string; conditions?: Record<string, unknown> }>>;
  manifest: ActivityManifestEntry[];
  stepIndexToActivityId: Map<number, string>;
  prevActivityId: string;
  prevResult: unknown;
  lastPivotId: string | null;
  triggerId: string;
}

// ── Step types ───────────────────────────────────────────────────────────────

/** A step extracted from an execution's event timeline. */
export interface ExtractedStep {
  /** Step kind: 'tool' for DB/MCP tool calls, 'llm' for LLM interpretation */
  kind: 'tool' | 'llm';
  toolName: string;
  arguments: Record<string, unknown>;
  result: unknown;
  source: 'db' | 'mcp' | 'llm';
  mcpServerId?: string;
  /** For LLM steps: the system/user messages that produced this response */
  promptMessages?: Array<{ role: string; content: string }>;
}

// ── Enhanced compilation plan ────────────────────────────────────────────────

/** Specifies how an iteration should be constructed in the YAML DAG. */
export interface IterationSpec {
  /** Index of the step that is the loop body (in the coreSteps list). */
  bodyStepIndex: number;
  /** Tool name for the iterated call. */
  toolName: string;
  /** Server ID for the iterated tool. */
  serverId?: string;
  /** Index of the step whose output produces the array to iterate. */
  sourceStepIndex: number;
  /** Dot-path to the array field in the source step's result. */
  sourceField: string;
  /** Keys that vary per iteration item. */
  varyingKeys: string[];
  /** Constant args shared across all iterations. */
  constantArgs: Record<string, unknown>;
  /**
   * Key mappings: when the array item key doesn't match the tool's arg key.
   * E.g., { url: 'href' } means tool wants 'url' but array items have 'href'.
   * A null value means the key is computed/generated, not from the array.
   */
  keyMappings: Record<string, string | null>;
}

/** A directed edge in the data flow graph. */
export interface DataFlowEdge {
  /** Source: 'trigger' for user input, or step index. */
  fromStep: number | 'trigger';
  /** Source field name (dot-path in result or trigger input key). */
  fromField: string;
  /** Target step index. */
  toStep: number;
  /** Target argument key. */
  toField: string;
  /** Whether this is a session/handle wire (page_id, _handle). */
  isSessionWire: boolean;
  /**
   * Transform spec when source format doesn't match target format.
   * When present, the build stage inserts a reshape activity between
   * the source and consuming step to apply field renames and defaults.
   */
  transform?: {
    /** Per-field mapping: target key → source key. null = computed/not in source. */
    fieldMap: Record<string, string | null>;
    /** Static defaults to inject into each reshaped item. */
    defaults?: Record<string, unknown>;
    /** For computed fields (null in fieldMap): derivation hint. */
    derivations?: Record<string, {
      sourceKey: string;
      strategy: 'slugify' | 'prefix' | 'template' | 'passthrough';
      prefix?: string;
      suffix?: string;
      template?: string;
    }>;
  };
}

/** Per-step semantic annotation from the LLM. */
export interface StepSpec {
  /** Original step index (in the post-collapse list). */
  index: number;
  /** What this step accomplishes in the workflow. */
  purpose: string;
  /** Whether this step is core or exploratory. */
  disposition: 'core' | 'exploratory';
}

/** Enhanced compilation plan — the LLM's full understanding of the workflow. */
export interface EnhancedCompilationPlan {
  /** Human-readable summary of workflow intent. */
  intent: string;
  /** Suggested workflow description for discovery. */
  description: string;
  /** Per-step annotations. */
  steps: StepSpec[];
  /** Indices of core steps to keep. */
  coreStepIndices: number[];
  /** Refined input field classifications. */
  inputs: Array<{
    key: string;
    type: string;
    classification: 'dynamic' | 'fixed';
    description: string;
    default?: unknown;
  }>;
  /** Iteration specifications (may be multiple for multi-loop workflows). */
  iterations: IterationSpec[];
  /** Data flow edges between steps. */
  dataFlow: DataFlowEdge[];
  /** Session/handle fields that must be threaded through the DAG. */
  sessionFields: string[];
  /** Whether the workflow contains iteration/looping patterns. */
  hasIteration: boolean;
}

// ── Pipeline context ─────────────────────────────────────────────────────────

/** Options for YAML workflow generation. */
export interface GenerateYamlOptions {
  workflowId: string;
  taskQueue: string;
  workflowName: string;
  /** User-chosen name for the YAML workflow */
  name: string;
  description?: string;
  /** HotMesh app namespace (shared across flows). Defaults to 'longtail'. */
  appId?: string;
  /** Graph subscribes topic. Defaults to sanitized name. */
  subscribes?: string;
}

/** Result from YAML workflow generation. */
export interface GenerateYamlResult {
  yaml: string;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  activityManifest: ActivityManifestEntry[];
  graphTopic: string;
  appId: string;
  tags: string[];
  inputFieldMeta: InputFieldMeta[];
  originalPrompt: string;
  category: string;
  /** LLM compilation plan (null if LLM unavailable or skipped). */
  compilationPlan: EnhancedCompilationPlan | null;
}

/** Shared context accumulated through pipeline stages. */
export interface PipelineContext {
  // ── Inputs ──
  options: {
    workflowId: string;
    taskQueue: string;
    workflowName: string;
    name: string;
    description?: string;
    appId: string;
    subscribes: string;
  };
  execution: WorkflowExecution;
  originalPrompt: string;

  // ── Extract stage outputs ──
  rawSteps: ExtractedStep[];

  // ── Analyze stage outputs ──
  collapsedSteps: ExtractedStep[];
  patternAnnotations: PatternAnnotation[];
  naiveInputs: InputFieldMeta[];

  // ── Compile stage outputs ──
  compilationPlan: EnhancedCompilationPlan | null;
  /** Steps after filtering out exploratory ones per the compilation plan. */
  coreSteps: ExtractedStep[];
  /** Final refined input field metadata. */
  refinedInputs: InputFieldMeta[];

  // ── Build stage outputs ──
  yaml: string;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  activityManifest: ActivityManifestEntry[];
  tags: string[];
  category: string;

  // ── Validate stage outputs ──
  validationIssues: string[];
}
