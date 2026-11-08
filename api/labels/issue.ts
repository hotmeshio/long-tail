import * as labels from '../../services/labels';
import { mayIssueCredentials } from '../../modules/capabilities';
import { loggerRegistry } from '../../lib/logger';
import type { LTApiAuth, LTApiResult } from '../../types/sdk';
import type { LabelIssueRequest, LabelLayoutRequest, LabelOutput, LabelSource } from '../../types/labels';
import { labelFailure } from './errors';

/**
 * Lay out a print job without printing or recording it. Sensitive templates
 * come back masked: positions without codes.
 *
 * @returns `{ status: 200, data: { template, sheet, warnings, labelCount } }`
 */
export async function previewLabels(
  input: { template: string; source: LabelSource; layout?: LabelLayoutRequest },
  auth: LTApiAuth,
): Promise<LTApiResult> {
  try {
    return { status: 200, data: await labels.previewLabels(input, auth) };
  } catch (err) {
    return labelFailure(err);
  }
}

/**
 * Issue labels: recorded in the label ledger before any code is composed.
 * Sensitive templates (every identity template) need `confirm: true`.
 *
 * @returns `{ status: 200, data: { job, replay, warnings, sheet?, pdf?, zpl?, receipt? } }`;
 *   400 bad request, 403 no access, 404 unknown template, 428 confirmation required,
 *   502 the transport failed after the job was recorded
 */
export async function issueLabels(input: LabelIssueRequest, auth: LTApiAuth): Promise<LTApiResult> {
  try {
    const result = await labels.issueLabels(input, auth);
    loggerRegistry.info(`[long-tail] labels issued: job=${result.job.id} template=${input.template} labels=${result.job.label_count} output=${input.output}${result.replay ? ' replay' : ''}`);
    return { status: 200, data: result };
  } catch (err) {
    return labelFailure(err);
  }
}

/**
 * Rotate a user's badge credential and print the new badge in one act. The
 * old code stops resolving immediately. Needs credentialIssuer and `confirm`.
 */
export async function reissueBadge(
  input: { userId: string; template: string; layout?: LabelLayoutRequest; output: LabelOutput; confirm?: boolean },
  auth: LTApiAuth,
): Promise<LTApiResult> {
  try {
    const result = await labels.reissueBadge(input, auth);
    loggerRegistry.info(`[long-tail] badge reissued: job=${result.reissueJobId} template=${input.template}`);
    return { status: 200, data: result };
  } catch (err) {
    return labelFailure(err);
  }
}

/** Label history as the caller may see it: credential issuers see every job; others see item jobs and their own. */
export async function listLabelJobs(
  input: { template?: string; subjectUserId?: string; limit?: number; offset?: number },
  auth: LTApiAuth,
): Promise<LTApiResult> {
  try {
    const jobs = await labels.listLabelJobs({ ...input, readerId: auth.userId, seesCredentials: await mayIssueCredentials(auth) });
    return { status: 200, data: { jobs } };
  } catch (err) {
    return labelFailure(err);
  }
}

async function readableJob(id: string, auth: LTApiAuth) {
  const job = await labels.getLabelJob(id);
  if (!job) return null;
  if (job.sensitive && job.requested_by !== auth.userId && !(await mayIssueCredentials(auth))) return null;
  return job;
}

export async function getLabelJob(input: { id: string }, auth: LTApiAuth): Promise<LTApiResult> {
  try {
    const { isUuid } = await import('../../lib/uuid');
    const job = isUuid(input.id) ? await readableJob(input.id, auth) : null;
    return job ? { status: 200, data: job } : { status: 404, error: 'Label job not found' };
  } catch (err) {
    return labelFailure(err);
  }
}

/**
 * Print a recorded job again from its source, with the template as it is
 * now: the whole job, or `indices` of its labels. A new job is recorded.
 */
export async function reprintLabelJob(
  input: { id: string; indices?: number[]; output: LabelOutput; layout?: LabelLayoutRequest; confirm?: boolean },
  auth: LTApiAuth,
): Promise<LTApiResult> {
  try {
    const { isUuid } = await import('../../lib/uuid');
    const job = isUuid(input.id) ? await readableJob(input.id, auth) : null;
    if (!job || job.action !== 'print' || !job.template_name) return { status: 404, error: 'Label job not found' };
    const named = job.subject_user_ids ?? job.targets ?? [];
    const only = input.indices?.length ? input.indices.map((i) => named[i]).filter((v): v is string => v !== undefined) : undefined;
    return issueLabels({
      template: job.template_name,
      source: job.source as LabelSource,
      layout: input.layout,
      output: input.output,
      confirm: input.confirm,
      only,
    }, auth);
  } catch (err) {
    return labelFailure(err);
  }
}
