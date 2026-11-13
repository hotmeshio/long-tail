/** Advisory lock class for workflow schedules; the second key is hashtext(workflow_type). */
export const CRON_LOCK_CLASS = 72_746;

export const LOCK_WORKFLOW_CRON = `\
SELECT pg_advisory_xact_lock($1, hashtext($2))`;

export const AWAIT_WORKFLOW_CRON = `\
SELECT pg_advisory_xact_lock_shared($1, hashtext($2))`;

export const GET_SCHEDULE_CONFIG = `\
SELECT cron_schedule, invocable, task_queue
FROM lt_config_workflows WHERE workflow_type = $1`;

export const GET_WORKFLOW_CRON = `\
SELECT job_id, schedule FROM lt_workflow_crons WHERE workflow_type = $1`;

export const LIST_WORKFLOW_CRONS = `\
SELECT workflow_type, job_id, schedule FROM lt_workflow_crons ORDER BY workflow_type`;

export const RECORD_WORKFLOW_CRON = `\
INSERT INTO lt_workflow_crons (workflow_type, job_id, schedule)
VALUES ($1, $2, $3)
ON CONFLICT (workflow_type) DO UPDATE
  SET job_id = EXCLUDED.job_id, schedule = EXCLUDED.schedule, updated_at = NOW()`;
