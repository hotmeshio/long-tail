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

export const LIST_AGENT_IDS = `
  SELECT id FROM lt_agents ORDER BY id
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

/**
 * Apply — code is source of truth for the declared fields. Runtime state
 * (user_id, capabilities, metadata, last_run_at) is never touched; the
 * IS DISTINCT FROM guard makes an unchanged declaration a zero-row no-op.
 */
export const APPLY_AGENT = `
  INSERT INTO lt_agents (id, description, status, user_id, knowledge_domain,
    capabilities, behaviors, goals, rules, workflow_type, pipeline_id, metadata)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
  ON CONFLICT (id) DO UPDATE SET
    description = EXCLUDED.description,
    status = EXCLUDED.status,
    knowledge_domain = EXCLUDED.knowledge_domain,
    behaviors = EXCLUDED.behaviors,
    goals = EXCLUDED.goals,
    rules = EXCLUDED.rules,
    workflow_type = EXCLUDED.workflow_type,
    pipeline_id = EXCLUDED.pipeline_id,
    updated_at = NOW()
  WHERE (lt_agents.description, lt_agents.status, lt_agents.knowledge_domain,
         lt_agents.behaviors, lt_agents.goals, lt_agents.rules,
         lt_agents.workflow_type, lt_agents.pipeline_id)
    IS DISTINCT FROM
        (EXCLUDED.description, EXCLUDED.status, EXCLUDED.knowledge_domain,
         EXCLUDED.behaviors, EXCLUDED.goals, EXCLUDED.rules,
         EXCLUDED.workflow_type, EXCLUDED.pipeline_id)
  RETURNING (xmax = 0) AS inserted
`;

export const KNOWLEDGE_COUNT = `
  SELECT COUNT(*)::int AS count FROM lt_knowledge WHERE domain = $1
`;

export const ESCALATION_COUNT = `
  SELECT COUNT(*)::int AS count FROM lt_escalations
  WHERE status = 'pending' AND created_by = $1
`;
