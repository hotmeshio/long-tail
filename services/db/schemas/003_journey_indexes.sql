-- Indexes for origin_id-based journey queries.

-- Supports WHERE origin_id = ... on tasks (journey detail, task lineage).
CREATE INDEX IF NOT EXISTS idx_lt_tasks_origin_id
  ON lt_tasks (origin_id)
  WHERE origin_id IS NOT NULL;

-- Supports WHERE origin_id = ... on escalations (journey detail).
CREATE INDEX IF NOT EXISTS idx_lt_escalations_origin_id
  ON lt_escalations (origin_id)
  WHERE origin_id IS NOT NULL;
