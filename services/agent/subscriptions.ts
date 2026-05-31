import { getPool } from '../../lib/db';
import {
  LIST_SUBSCRIPTIONS,
  GET_SUBSCRIPTION,
  INSERT_SUBSCRIPTION,
  UPDATE_SUBSCRIPTION,
  DELETE_SUBSCRIPTION,
  SEED_SUBSCRIPTION,
  LIST_ACTIVE_SUBSCRIPTIONS,
} from './subscription-sql';

export interface AgentSubscription {
  id: string;
  agent_id: string;
  topic: string;
  filter?: Record<string, any>;
  reaction_type: 'durable' | 'pipeline' | 'mcp_query' | 'capability';
  workflow_type?: string;
  pipeline_id?: string;
  mcp_prompt?: string;
  server_id?: string;
  tool_name?: string;
  input_mapping: Record<string, any>;
  execute_as?: string;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface ActiveSubscription extends AgentSubscription {
  agent_name: string;
  agent_user_id?: string;
}

export async function listSubscriptions(agentId: string): Promise<AgentSubscription[]> {
  const pool = getPool();
  const { rows } = await pool.query(LIST_SUBSCRIPTIONS, [agentId]);
  return rows;
}

export async function getSubscription(id: string): Promise<AgentSubscription | null> {
  const pool = getPool();
  const { rows } = await pool.query(GET_SUBSCRIPTION, [id]);
  return rows[0] ?? null;
}

export async function createSubscription(
  agentId: string,
  data: Partial<AgentSubscription>,
): Promise<AgentSubscription> {
  const pool = getPool();
  const { rows } = await pool.query(INSERT_SUBSCRIPTION, [
    agentId,
    data.topic,
    data.filter ? JSON.stringify(data.filter) : null,
    data.reaction_type,
    data.workflow_type ?? null,
    data.pipeline_id ?? null,
    data.mcp_prompt ?? null,
    JSON.stringify(data.input_mapping ?? {}),
    data.execute_as ?? null,
    data.enabled !== false,
    data.server_id ?? null,
    data.tool_name ?? null,
  ]);
  return rows[0];
}

export async function updateSubscription(
  id: string,
  data: Partial<AgentSubscription>,
): Promise<AgentSubscription | null> {
  const pool = getPool();
  const { rows } = await pool.query(UPDATE_SUBSCRIPTION, [
    id,
    data.topic ?? null,
    data.filter ? JSON.stringify(data.filter) : null,
    data.reaction_type ?? null,
    data.workflow_type ?? null,
    data.pipeline_id ?? null,
    data.mcp_prompt ?? null,
    data.input_mapping ? JSON.stringify(data.input_mapping) : null,
    data.execute_as ?? null,
    data.enabled ?? null,
    data.server_id ?? null,
    data.tool_name ?? null,
  ]);
  return rows[0] ?? null;
}

export async function deleteSubscription(id: string): Promise<boolean> {
  const pool = getPool();
  const { rowCount } = await pool.query(DELETE_SUBSCRIPTION, [id]);
  return (rowCount ?? 0) > 0;
}

export async function listActiveSubscriptions(): Promise<ActiveSubscription[]> {
  const pool = getPool();
  const { rows } = await pool.query(LIST_ACTIVE_SUBSCRIPTIONS);
  return rows;
}

/**
 * Seed a subscription at startup (insert-if-absent).
 * Conflict on (agent_id, topic) — DB is source of truth after first boot.
 */
export async function seedSubscription(
  agentId: string,
  data: Partial<AgentSubscription>,
): Promise<boolean> {
  const pool = getPool();
  const { rowCount } = await pool.query(SEED_SUBSCRIPTION, [
    agentId,
    data.topic,
    data.filter ? JSON.stringify(data.filter) : null,
    data.reaction_type,
    data.workflow_type ?? null,
    data.pipeline_id ?? null,
    data.mcp_prompt ?? null,
    JSON.stringify(data.input_mapping ?? {}),
    data.execute_as ?? null,
    data.server_id ?? null,
    data.tool_name ?? null,
  ]);
  return (rowCount ?? 0) > 0;
}
