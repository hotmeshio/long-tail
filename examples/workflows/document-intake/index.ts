/**
 * Document Intake Workflow, the reference example for human review of
 * model-extracted values beside the documents they came from:
 *
 *   1. store the application and ID card (stageSampleDocuments)
 *   2. extract proposed values and a score per value (extractApplication)
 *   3. park one escalation for the `intake-verifier` role: the proposals ride
 *      envelope.formDefaults, the scores envelope.confidence, and the files
 *      `files`, signed for each reader when the page opens and on claim; the
 *      extractor version rides metadata, so reports compare versions
 *   4. record the verified values and every correction (recordReview)
 *
 * Invoke via the dashboard (Workflows → documentIntake) with:
 *   { data: { applicationId: 'APP-1042' }, metadata: { source: 'dashboard' } }
 */

import { Durable } from '@hotmeshio/hotmesh';

import type { LTEnvelope } from '../../../types';
import { conditional } from '../../../services/orchestrator/condition';
import * as activities from './activities';
import { INTAKE_ROLE, INTAKE_SCHEMA_VERSION, type IntakeReviewV1 } from './forms';

type ActivitiesType = typeof activities;

export async function documentIntake(envelope: LTEnvelope): Promise<any> {
  const applicationId = String(envelope.data?.applicationId ?? 'APP-1001');
  const { stageSampleDocuments, extractApplication, recordReview } = Durable.workflow.proxyActivities<ActivitiesType>({
    activities,
    retry: { maximumAttempts: 3 },
  });

  const files = await stageSampleDocuments(applicationId);
  const extraction = await extractApplication(applicationId);

  const ctx = Durable.workflow.workflowInfo();
  const review = await conditional<IntakeReviewV1>(`document-intake-${ctx.workflowId}`, {
    role: INTAKE_ROLE,
    type: 'intake',
    subtype: 'account-application',
    priority: 2,
    description: `Account application — ${applicationId}`,
    workflowType: 'documentIntake',
    metadata: { applicationId, extractor: extraction.extractor },
    envelope: {
      formDefaults: extraction.values,
      confidence: extraction.confidence,
    },
    files,
    schemaVersion: INTAKE_SCHEMA_VERSION,
  });

  if (!review) {
    return { type: 'return' as const, data: { applicationId, cancelled: review === null, expired: review === false } };
  }

  const result = await recordReview({ proposed: extraction.values, review });
  return { type: 'return' as const, data: { applicationId, ...result } };
}
