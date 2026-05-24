export const LIST_TOPICS = `
  SELECT t.*,
    COALESCE(s.sub_count, 0)::int AS subscriber_count
  FROM lt_topic_catalog t
  LEFT JOIN LATERAL (
    SELECT COUNT(*)::int AS sub_count
    FROM lt_agent_subscriptions
    WHERE enabled = true
      AND (topic = t.topic OR topic LIKE '%>%' OR topic LIKE '%*%')
  ) s ON true
  WHERE ($1::text IS NULL OR t.category = $1)
    AND ($2::text IS NULL OR t.topic ILIKE '%' || $2 || '%' OR t.description ILIKE '%' || $2 || '%')
  ORDER BY t.category, t.topic
  LIMIT $3 OFFSET $4
`;

export const COUNT_TOPICS = `
  SELECT COUNT(*)::int AS total FROM lt_topic_catalog
  WHERE ($1::text IS NULL OR category = $1)
    AND ($2::text IS NULL OR topic ILIKE '%' || $2 || '%' OR description ILIKE '%' || $2 || '%')
`;

export const GET_TOPIC = `
  SELECT * FROM lt_topic_catalog WHERE topic = $1
`;

export const INSERT_TOPIC = `
  INSERT INTO lt_topic_catalog
    (topic, description, category, payload_schema, example_payload, source, tags)
  VALUES ($1, $2, $3, $4, $5, $6, $7)
  RETURNING *
`;

export const UPDATE_TOPIC = `
  UPDATE lt_topic_catalog SET
    description = COALESCE($2, description),
    category = COALESCE($3, category),
    payload_schema = COALESCE($4, payload_schema),
    example_payload = COALESCE($5, example_payload),
    tags = COALESCE($6, tags)
  WHERE topic = $1
  RETURNING *
`;

export const DELETE_TOPIC = `
  DELETE FROM lt_topic_catalog WHERE topic = $1 AND source != 'system'
`;

export const UPSERT_ON_PUBLISH = `
  INSERT INTO lt_topic_catalog
    (topic, category, source, example_payload, last_seen_at)
  VALUES ($1, $2, $3, $4, NOW())
  ON CONFLICT (topic) DO UPDATE SET
    last_seen_at = NOW(),
    example_payload = COALESCE(EXCLUDED.example_payload, lt_topic_catalog.example_payload)
`;

export const SEED_TOPIC = `
  INSERT INTO lt_topic_catalog
    (topic, description, category, payload_schema, example_payload, source, tags)
  VALUES ($1, $2, $3, $4, $5, $6, $7)
  ON CONFLICT (topic) DO NOTHING
`;

export const RESET_TOPIC = `
  INSERT INTO lt_topic_catalog
    (topic, description, category, payload_schema, example_payload, source, tags, managed)
  VALUES ($1, $2, $3, $4, $5, $6, $7, true)
  ON CONFLICT (topic) DO UPDATE SET
    description = EXCLUDED.description,
    category = EXCLUDED.category,
    payload_schema = EXCLUDED.payload_schema,
    example_payload = EXCLUDED.example_payload,
    source = EXCLUDED.source,
    tags = EXCLUDED.tags,
    managed = true
`;

export const LIST_SUBSCRIBERS = `
  SELECT s.id, s.agent_id, s.topic, s.reaction_type,
    a.id AS agent_name
  FROM lt_agent_subscriptions s
  JOIN lt_agents a ON s.agent_id = a.id
  WHERE s.enabled = true AND a.status = 'active'
  ORDER BY s.created_at
`;
