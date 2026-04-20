/**
 * YAML Workflow types — deterministic HotMesh workflows generated from MCP tool call sequences.
 */

export interface InputFieldMeta {
  key: string;
  type: string;
  default?: unknown;
  description: string;
  classification: 'dynamic' | 'fixed' | 'wired';
  source_step_index: number;
  source_tool: string;
}

export type LTYamlWorkflowStatus = 'draft' | 'deployed' | 'active' | 'archived' | 'error';

export interface LTYamlWorkflowRecord {
  id: string;
  name: string;
  description: string | null;
  app_id: string;
  app_version: string;
  source_workflow_id: string | null;
  source_workflow_type: string | null;
  yaml_content: string;
  graph_topic: string;
  input_schema: Record<string, unknown>;
  output_schema: Record<string, unknown>;
  activity_manifest: ActivityManifestEntry[];
  tags: string[];
  status: LTYamlWorkflowStatus;
  content_version: number;
  deployed_content_version: number | null;
  deployed_at: Date | null;
  activated_at: Date | null;
  input_field_meta?: InputFieldMeta[];
  original_prompt: string | null;
  category: string | null;
  metadata: Record<string, unknown> | null;
  cron_schedule: string | null;
  cron_envelope: Record<string, unknown> | null;
  execute_as: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface LTYamlWorkflowVersionRecord {
  id: string;
  workflow_id: string;
  version: number;
  yaml_content: string;
  activity_manifest: ActivityManifestEntry[];
  input_schema: Record<string, unknown>;
  output_schema: Record<string, unknown>;
  change_summary: string | null;
  created_at: Date;
}

export interface ActivityManifestEntry {
  /** Activity id within the YAML graph (e.g., 'a1') */
  activity_id: string;
  /** Human-readable title */
  title: string;
  /** HotMesh activity type */
  type: 'trigger' | 'worker' | 'hook';
  /** Worker topic for routing (coarse stream grouping) */
  topic: string;
  /** Workflow name for dispatch routing within a shared topic stream */
  workflow_name?: string;
  /** How this activity executes at runtime */
  tool_source: 'db' | 'mcp' | 'llm' | 'trigger' | 'transform' | 'signal';
  /** For hook activities: the external signal topic (e.g., 'escalation.resolved.<graph>') */
  hook_topic?: string;
  /** For hook activities: the JSON Schema describing the expected signal payload */
  signal_schema?: Record<string, unknown>;
  /** Original MCP server ID that provided this tool (tool steps only) */
  mcp_server_id?: string;
  /** Tool name — MCP tool name or DB tool name (tool steps only) */
  mcp_tool_name?: string;
  /** Original arguments the LLM chose (stored for reference / defaults) */
  tool_arguments?: Record<string, unknown>;
  /** Input data mappings (e.g., { field: '{a1.output.data.x}' }) */
  input_mappings: Record<string, unknown>;
  /** Known output field names */
  output_fields: string[];
  /** LLM prompt template — use {field} for interpolation from input maps (llm steps only) */
  prompt_template?: string;
  /** LLM model identifier (llm steps only). Defaults to LLM_MODEL_SECONDARY from modules/defaults. */
  model?: string;
  /** Transform spec for reshape activities (transform steps only) */
  transform_spec?: {
    /** Source field to reshape (from prior step's output) */
    sourceField: string;
    /** Target field name for the reshaped output */
    targetField: string;
    /** Per-field mapping: target key → source key. null = computed. */
    fieldMap: Record<string, string | null>;
    /** Static defaults to inject into each reshaped item */
    defaults?: Record<string, unknown>;
    /** Derivation specs for computed fields (null in fieldMap) */
    derivations?: Record<string, {
      sourceKey: string;
      strategy: 'slugify' | 'prefix' | 'template' | 'passthrough' | 'concat';
      prefix?: string;
      suffix?: string;
      template?: string;
      parts?: string[];
    }>;
  };
}
