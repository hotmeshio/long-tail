export const LIST_AGENTS = `
  SELECT a.*,
    COALESCE(s.sub_count, 0)::int AS subscription_count,
    s.sub_topics
  FROM lt_agents a
  LEFT JOIN LATERAL (
    SELECT COUNT(*)::int AS sub_count,
           array_agg(topic ORDER BY created_at) AS sub_topics
    FROM lt_agent_subscriptions
    WHERE agent_id = a.id AND enabled = true
  ) s ON true
  WHERE ($1::text IS NULL OR a.status = $1)
    AND ($2::text IS NULL OR a.knowledge_domain = $2)
  ORDER BY a.updated_at DESC
  LIMIT $3 OFFSET $4
`;

export const COUNT_AGENTS = `
  SELECT COUNT(*)::int AS total FROM lt_agents
  WHERE ($1::text IS NULL OR status = $1)
    AND ($2::text IS NULL OR knowledge_domain = $2)
`;

export const GET_AGENT = `
  SELECT * FROM lt_agents WHERE id = $1
`;

export const INSERT_AGENT = `
  INSERT INTO lt_agents (id, description, status, user_id, knowledge_domain,
    capabilities, behaviors, goals, rules, workflow_type, pipeline_id, metadata)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
  RETURNING *
`;

export const UPDATE_AGENT = `
  UPDATE lt_agents SET
    description = COALESCE($2, description),
    status = COALESCE($3, status),
    user_id = COALESCE($4, user_id),
    knowledge_domain = COALESCE($5, knowledge_domain),
    capabilities = COALESCE($6, capabilities),
    behaviors = COALESCE($7, behaviors),
    goals = COALESCE($8, goals),
    rules = COALESCE($9, rules),
    workflow_type = COALESCE($10, workflow_type),
    pipeline_id = COALESCE($11, pipeline_id),
    metadata = COALESCE($12, metadata),
    last_run_at = COALESCE($13, last_run_at)
  WHERE id = $1
  RETURNING *
`;

export const DELETE_AGENT = `
  DELETE FROM lt_agents WHERE id = $1
`;

export const SEED_AGENT = `
  INSERT INTO lt_agents (id, description, status, user_id, knowledge_domain,
    capabilities, behaviors, goals, rules, workflow_type, pipeline_id, metadata)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
  ON CONFLICT (id) DO NOTHING
`;

export const KNOWLEDGE_COUNT = `
  SELECT COUNT(*)::int AS count FROM lt_knowledge WHERE domain = $1
`;

export const ESCALATION_COUNT = `
  SELECT COUNT(*)::int AS count FROM lt_escalations
  WHERE status = 'pending' AND created_by = $1
`;
