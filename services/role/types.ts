/** Type definitions for the role and escalation chain service. */

export interface EscalationChain {
  source_role: string;
  target_role: string;
}

export interface RoleDetail {
  role: string;
  title: string | null;
  description: string | null;
  form_schema: Record<string, any> | null;
  properties: Record<string, any>;
  ops_visible: boolean;
  parent_role: string | null;
  user_count: number;
  chain_count: number;
  workflow_count: number;
}

export interface UpdateRoleInput {
  title?: string | null;
  description?: string | null;
  form_schema?: Record<string, any> | null;
  properties?: Record<string, any> | null;
  ops_visible?: boolean;
  parent_role?: string | null;
}
