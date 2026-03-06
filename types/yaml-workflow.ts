/**
 * YAML Workflow types — deterministic HotMesh workflows generated from MCP tool call sequences.
 */

export type LTYamlWorkflowStatus = 'draft' | 'deployed' | 'active' | 'archived';

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
  status: LTYamlWorkflowStatus;
  deployed_at: Date | null;
  activated_at: Date | null;
  metadata: Record<string, unknown> | null;
  created_at: Date;
  updated_at: Date;
}

export interface ActivityManifestEntry {
  /** Activity id within the YAML graph (e.g., 'a1') */
  activity_id: string;
  /** Human-readable title */
  title: string;
  /** HotMesh activity type */
  type: 'trigger' | 'worker';
  /** Worker topic for routing */
  topic: string;
  /** How this activity executes at runtime */
  tool_source: 'db' | 'mcp' | 'llm' | 'trigger';
  /** Original MCP server ID that provided this tool (tool steps only) */
  mcp_server_id?: string;
  /** Tool name — MCP tool name or DB tool name (tool steps only) */
  mcp_tool_name?: string;
  /** Original arguments the LLM chose (stored for reference / defaults) */
  tool_arguments?: Record<string, unknown>;
  /** Input data mappings (e.g., { field: '{a1.output.data.x}' }) */
  input_mappings: Record<string, string>;
  /** Known output field names */
  output_fields: string[];
  /** LLM prompt template — use {field} for interpolation from input maps (llm steps only) */
  prompt_template?: string;
  /** LLM model identifier (llm steps only). Defaults to 'gpt-4o-mini'. */
  model?: string;
}
