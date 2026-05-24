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
     input_mapping, execute_as, enabled)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
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
    enabled = COALESCE($10, enabled)
  WHERE id = $1
  RETURNING *
`;

export const DELETE_SUBSCRIPTION = `
  DELETE FROM lt_agent_subscriptions WHERE id = $1
`;

export const SEED_SUBSCRIPTION = `
  INSERT INTO lt_agent_subscriptions
    (agent_id, topic, filter, reaction_type, workflow_type, pipeline_id, mcp_prompt,
     input_mapping, execute_as, enabled)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, true)
  ON CONFLICT (agent_id, topic) DO NOTHING
`;

export const LIST_ACTIVE_SUBSCRIPTIONS = `
  SELECT s.*, a.id AS agent_name, a.user_id AS agent_user_id
  FROM lt_agent_subscriptions s
  JOIN lt_agents a ON s.agent_id = a.id
  WHERE s.enabled = true AND a.status = 'active'
  ORDER BY s.created_at
`;
