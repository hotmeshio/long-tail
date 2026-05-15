/**
 * Agent data model — autonomous personas that compose identity, memory,
 * capabilities, behaviors, and goals atop existing platform primitives.
 */

export type LTAgentStatus = 'inactive' | 'active' | 'paused' | 'error';

export interface AgentCapability {
  /** MCP server ID (UUID) */
  serverId: string;
  /** Specific tool names; undefined = all tools on that server */
  toolNames?: string[];
}

export interface AgentTrigger {
  /** NATS subject pattern to subscribe to */
  event: string;
  /** Optional filter criteria applied to the event payload */
  filter?: Record<string, any>;
}

export interface AgentBehaviors {
  /** Cron expression for scheduled runs */
  cron?: string;
  /** Event-driven triggers */
  triggers?: AgentTrigger[];
  /** Escalation routing rules */
  escalationRules?: Record<string, any>;
}

export interface LTAgent {
  id: string;
  name: string;
  description?: string;
  status: LTAgentStatus;

  /** Service account (bot user) this agent runs as */
  user_id?: string;

  /** Knowledge domain this agent owns and accumulates into */
  knowledge_domain?: string;

  /** MCP servers/tools this agent can invoke */
  capabilities: AgentCapability[];

  /** Triggers, schedules, escalation patterns */
  behaviors: AgentBehaviors;

  /** Natural language description of what the agent is trying to achieve */
  goals?: string;

  /** Guardrails and constraints */
  rules?: string;

  /** Primary workflow this agent runs (soft ref to lt_config_workflows.workflow_type) */
  workflow_type?: string;

  /** Compiled pipeline (soft ref to lt_yaml_workflows.id) */
  pipeline_id?: string;

  metadata: Record<string, any>;
  last_run_at?: string;
  created_at: string;
  updated_at: string;
}

export interface LTAgentStats {
  knowledge_count: number;
  escalation_count: number;
  last_execution_at?: string;
}
