// ─── Workflow set CRUD ──────────────────────────────────────────────────────

export const CREATE_WORKFLOW_SET = `
  INSERT INTO lt_workflow_sets (name, description, specification, plan, namespaces, source_workflow_id)
  VALUES ($1, $2, $3, $4, $5, $6)
  RETURNING *`;

export const GET_WORKFLOW_SET = `
  SELECT * FROM lt_workflow_sets WHERE id = $1`;

export const UPDATE_WORKFLOW_SET_PLAN = `
  UPDATE lt_workflow_sets
  SET plan = $2, namespaces = $3, status = 'planned', updated_at = NOW()
  WHERE id = $1
  RETURNING *`;

export const UPDATE_WORKFLOW_SET_STATUS = `
  UPDATE lt_workflow_sets
  SET status = $2, updated_at = NOW()
  WHERE id = $1
  RETURNING *`;

export const DELETE_WORKFLOW_SET = `
  DELETE FROM lt_workflow_sets WHERE id = $1`;

export const LIST_WORKFLOW_SETS_BASE = `
  SELECT * FROM lt_workflow_sets`;
