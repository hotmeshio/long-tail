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
  deployed_at: string | null;
  activated_at: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}
