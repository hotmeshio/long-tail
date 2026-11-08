// lt_label_jobs: insert-only. A print row is written before any code leaves
// the server; a repeated idempotency key returns the first row.

import { getPool } from '../../lib/db';
import type { LabelJob } from '../../types/labels';

const INSERT_JOB = `
  INSERT INTO lt_label_jobs (
    action, requested_by, idempotency_key, template_name, template_revision, template_snapshot,
    scheme_version, scheme_kind, sensitive, source, subject_user_ids, targets, label_count, media, output
  ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING *`;

const GET_JOB_BY_KEY = 'SELECT * FROM lt_label_jobs WHERE idempotency_key = $1';

/** Take the delivery lease: only an undelivered job whose lease is free or lapsed. One statement, so one claimer wins. */
const CLAIM_DELIVERY = `
  UPDATE lt_label_jobs SET delivery_claimed_at = NOW()
  WHERE id = $1 AND delivered_at IS NULL
    AND (delivery_claimed_at IS NULL OR delivery_claimed_at < NOW() - make_interval(secs => $2))
  RETURNING id`;
const MARK_DELIVERED = 'UPDATE lt_label_jobs SET delivered_at = NOW() WHERE id = $1 AND delivered_at IS NULL';
const RELEASE_DELIVERY = 'UPDATE lt_label_jobs SET delivery_claimed_at = NULL WHERE id = $1 AND delivered_at IS NULL';
const GET_JOB = 'SELECT * FROM lt_label_jobs WHERE id = $1';

/** History as a reader may see it: everything for an issuer; item jobs and their own otherwise. */
const LIST_JOBS = `
  SELECT * FROM lt_label_jobs
  WHERE ($1::boolean OR NOT sensitive OR requested_by = $2::uuid)
    AND ($3::text IS NULL OR template_name = $3)
    AND ($4::uuid IS NULL OR $4::uuid = ANY(subject_user_ids))
  ORDER BY created_at DESC
  LIMIT $5 OFFSET $6`;

export interface NewLabelJob {
  action: LabelJob['action'];
  requested_by: string;
  idempotency_key?: string | null;
  template_name: string;
  template_revision: number;
  template_snapshot: unknown;
  scheme_version: number;
  scheme_kind: string;
  sensitive: boolean;
  source: unknown;
  subject_user_ids: string[] | null;
  targets: string[] | null;
  label_count: number;
  media: unknown;
  output: string;
}

function mapJob(row: any): LabelJob {
  return { ...row };
}

/** Record a job. With an idempotency key already used, returns that job and `replay: true`. */
export async function recordLabelJob(job: NewLabelJob): Promise<{ job: LabelJob; replay: boolean }> {
  const { rows } = await getPool().query(INSERT_JOB, [
    job.action, job.requested_by, job.idempotency_key ?? null, job.template_name, job.template_revision,
    JSON.stringify(job.template_snapshot), job.scheme_version, job.scheme_kind, job.sensitive,
    JSON.stringify(job.source), job.subject_user_ids, job.targets, job.label_count,
    JSON.stringify(job.media), job.output,
  ]);
  if (rows[0]) return { job: mapJob(rows[0]), replay: false };
  const existing = await getPool().query(GET_JOB_BY_KEY, [job.idempotency_key]);
  return { job: mapJob(existing.rows[0]), replay: true };
}

/** True when this caller now holds the job's delivery lease. */
export async function claimLabelDelivery(id: string, leaseSeconds: number): Promise<boolean> {
  const { rows } = await getPool().query(CLAIM_DELIVERY, [id, leaseSeconds]);
  return rows.length > 0;
}

export async function markLabelDelivered(id: string): Promise<void> {
  await getPool().query(MARK_DELIVERED, [id]);
}

/** Give the lease back after a failed send, so a retry need not wait for it to lapse. */
export async function releaseLabelDelivery(id: string): Promise<void> {
  await getPool().query(RELEASE_DELIVERY, [id]);
}

export async function getLabelJob(id: string): Promise<LabelJob | null> {
  const { rows } = await getPool().query(GET_JOB, [id]);
  return rows[0] ? mapJob(rows[0]) : null;
}

export async function listLabelJobs(opts: {
  readerId: string;
  seesCredentials: boolean;
  template?: string;
  subjectUserId?: string;
  limit?: number;
  offset?: number;
}): Promise<LabelJob[]> {
  const { rows } = await getPool().query(LIST_JOBS, [
    opts.seesCredentials, opts.readerId, opts.template ?? null, opts.subjectUserId ?? null,
    Math.min(opts.limit ?? 50, 200), opts.offset ?? 0,
  ]);
  return rows.map(mapJob);
}
