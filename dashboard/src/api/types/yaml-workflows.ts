export type LTYamlWorkflowStatus = 'draft' | 'deployed' | 'active' | 'archived';

export interface ActivityManifestEntry {
  activity_id: string;
  title: string;
  type: 'trigger' | 'worker';
  topic: string;
  tool_source: 'db' | 'mcp' | 'llm' | 'trigger';
  mcp_server_id?: string;
  mcp_tool_name?: string;
  tool_arguments?: Record<string, unknown>;
  input_mappings: Record<string, string>;
  output_fields: string[];
  prompt_template?: string;
  model?: string;
}

export interface InputFieldMeta {
  key: string;
  type: string;
  default?: unknown;
  description: string;
  classification: 'dynamic' | 'fixed' | 'wired';
  source_step_index: number;
  source_tool: string;
}

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
  deployed_at: string | null;
  activated_at: string | null;
  input_field_meta: InputFieldMeta[];
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export interface LTYamlWorkflowVersion {
  id: string;
  workflow_id: string;
  version: number;
  yaml_content: string;
  activity_manifest: ActivityManifestEntry[];
  input_schema: Record<string, unknown>;
  output_schema: Record<string, unknown>;
  change_summary: string | null;
  created_at: string;
}
