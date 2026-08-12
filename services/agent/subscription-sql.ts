export const LIST_SUBSCRIPTIONS = `
  SELECT * FROM lt_agent_subscriptions
  WHERE agent_id = $1
  ORDER BY created_at
`;

export const GET_SUBSCRIPTION = `
  SELECT * FROM lt_agent_subscriptions WHERE id = $1
`;

export const INSERT_SUBSCRIPTION = `
  INSERT INTO lt_agent_subscriptions
    (agent_id, topic, filter, reaction_type, workflow_type, pipeline_id, mcp_prompt,
     input_mapping, execute_as, enabled, server_id, tool_name)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
  RETURNING *
`;

export const UPDATE_SUBSCRIPTION = `
  UPDATE lt_agent_subscriptions SET
    topic = COALESCE($2, topic),
    filter = COALESCE($3, filter),
    reaction_type = COALESCE($4, reaction_type),
    workflow_type = COALESCE($5, workflow_type),
    pipeline_id = COALESCE($6, pipeline_id),
    mcp_prompt = COALESCE($7, mcp_prompt),
    input_mapping = COALESCE($8, input_mapping),
    execute_as = COALESCE($9, execute_as),
    enabled = COALESCE($10, enabled),
    server_id = COALESCE($11, server_id),
    tool_name = COALESCE($12, tool_name)
  WHERE id = $1
  RETURNING *
`;

export const DELETE_SUBSCRIPTION = `
  DELETE FROM lt_agent_subscriptions WHERE id = $1
`;

export const SEED_SUBSCRIPTION = `
  INSERT INTO lt_agent_subscriptions
    (agent_id, topic, filter, reaction_type, workflow_type, pipeline_id, mcp_prompt,
     input_mapping, execute_as, enabled, server_id, tool_name)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, true, $10, $11)
  ON CONFLICT (agent_id, topic) DO NOTHING
`;

/**
 * Apply — code is source of truth for the reaction fields. `enabled` is left
 * alone on update (an admin kill-switch stays honored); the IS DISTINCT FROM
 * guard makes an unchanged declaration a zero-row no-op.
 */
export const APPLY_SUBSCRIPTION = `
  INSERT INTO lt_agent_subscriptions
    (agent_id, topic, filter, reaction_type, workflow_type, pipeline_id, mcp_prompt,
     input_mapping, execute_as, enabled, server_id, tool_name)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, true, $10, $11)
  ON CONFLICT (agent_id, topic) DO UPDATE SET
    filter = EXCLUDED.filter,
    reaction_type = EXCLUDED.reaction_type,
    workflow_type = EXCLUDED.workflow_type,
    pipeline_id = EXCLUDED.pipeline_id,
    mcp_prompt = EXCLUDED.mcp_prompt,
    input_mapping = EXCLUDED.input_mapping,
    execute_as = EXCLUDED.execute_as,
    server_id = EXCLUDED.server_id,
    tool_name = EXCLUDED.tool_name
  WHERE (lt_agent_subscriptions.filter, lt_agent_subscriptions.reaction_type,
         lt_agent_subscriptions.workflow_type, lt_agent_subscriptions.pipeline_id,
         lt_agent_subscriptions.mcp_prompt, lt_agent_subscriptions.input_mapping,
         lt_agent_subscriptions.execute_as, lt_agent_subscriptions.server_id,
         lt_agent_subscriptions.tool_name)
    IS DISTINCT FROM
        (EXCLUDED.filter, EXCLUDED.reaction_type, EXCLUDED.workflow_type,
         EXCLUDED.pipeline_id, EXCLUDED.mcp_prompt, EXCLUDED.input_mapping,
         EXCLUDED.execute_as, EXCLUDED.server_id, EXCLUDED.tool_name)
  RETURNING (xmax = 0) AS inserted
`;

export const LIST_ACTIVE_SUBSCRIPTIONS = `
  SELECT s.*, a.id AS agent_name, a.user_id AS agent_user_id
  FROM lt_agent_subscriptions s
  JOIN lt_agents a ON s.agent_id = a.id
  WHERE s.enabled = true AND a.status = 'active'
  ORDER BY s.created_at
`;
