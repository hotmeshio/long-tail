/**
 * Policy Document Workflow — the reference example for the role-owned, versioned
 * LIST view.
 *
 * The workflow is a loop: it opens ONE policy-review escalation to the
 * `policy-document` role and parks on it (conditionLT). A member claims and
 * publishes a revision; the workflow folds that into the next revision's state
 * and opens the next escalation. At most 10 revisions run per workflow execution;
 * the 10th iteration spawns a fresh child workflow (fire-and-forget) carrying the
 * current state, keeping replay history bounded.
 *
 * Concise facts (title, owner, revision, effective date) ride the escalation's
 * metadata so the list view reads them off the row. The full policy document body
 * travels in the escalation envelope (formDefaults) where long text belongs.
 */

import { Durable } from '@hotmeshio/hotmesh';

import type { LTEnvelope } from '../../../types';
import { conditionLT } from '../../../services/orchestrator/condition';
import { JOB_EXPIRE_SECS } from '../../../modules/defaults';
import {
  POLICY_ROLE,
  POLICY_SCHEMA_VERSION,
  INITIAL_POLICY_MARKDOWN,
  type PolicyResolverV1,
} from './forms';

const MAX_ITERATIONS = 10;
const TASK_QUEUE = 'long-tail-examples';

export async function policyDocument(envelope: LTEnvelope): Promise<any> {
  const {
    role = POLICY_ROLE,
    title = 'Refund Policy',
    owner = 'Legal',
    revision: startRevision = 1,
    effective_date: startDate = '2026-08-01',
    document: startDocument = INITIAL_POLICY_MARKDOWN,
  } = envelope.data ?? {};

  const ctx = Durable.workflow.workflowInfo();

  let meta = {
    title:          title as string,
    owner:          owner as string,
    revision:       startRevision as number,
    effective_date: startDate as string,
    document:       startDocument as string,
  };

  for (let i = 1; i <= MAX_ITERATIONS; i++) {
    const signalId = `policy-${ctx.workflowId}-${meta.revision}`;

    // Seed the edit form from the current state so the member revises in place.
    const formDefaults: PolicyResolverV1 = {
      policy: {
        title:         meta.title,
        effectiveDate: meta.effective_date,
        owner:         meta.owner,
        document:      meta.document,
      },
      approved: false,
    };

    // Open the live policy escalation and park. Concise facts ride the metadata
    // so the list view reads them off the row; the document body lives in the
    // envelope where long text belongs.
    const response = await conditionLT<PolicyResolverV1>(signalId, {
      role,
      type: 'policy-review',
      subtype: 'revision',
      priority: 2,
      description: `Review and revise "${meta.title}" (revision ${meta.revision}).`,
      workflowType: 'policyDocument',
      metadata: {
        title:          meta.title,
        owner:          meta.owner,
        revision:       meta.revision,
        effective_date: meta.effective_date,
      },
      envelope: { source: 'policy-document', formDefaults },
      schemaVersion: POLICY_SCHEMA_VERSION,
    });

    if (!response) {
      return { type: 'return' as const, data: { cancelled: true, atRevision: meta.revision } };
    }

    // Fold the resolution into the next iteration's state.
    const p = response.policy ?? ({} as PolicyResolverV1['policy']);
    meta = {
      title:          p.title          || meta.title,
      owner:          p.owner          || meta.owner,
      revision:       meta.revision + 1,
      effective_date: p.effectiveDate  || meta.effective_date,
      document:       p.document       || meta.document,
    };

    // After MAX_ITERATIONS revisions, continue as a fresh child workflow to
    // keep replay history bounded, then exit.
    if (i === MAX_ITERATIONS) {
      const childId = `${ctx.workflowId}-c${meta.revision}`;
      await Durable.workflow.startChild({
        workflowName: 'policyDocument',
        args: [{
          data: {
            role,
            title:          meta.title,
            owner:          meta.owner,
            revision:       meta.revision,
            effective_date: meta.effective_date,
            document:       meta.document,
          },
        }],
        taskQueue:  TASK_QUEUE,
        workflowId: childId,
        expire:     JOB_EXPIRE_SECS,
        entity:     'policyDocument',
        signalIn:   false,
      });
      return { type: 'return' as const, data: { continued: true, childId, atRevision: meta.revision } };
    }
  }

  return { type: 'return' as const, data: { done: true, atRevision: meta.revision } };
}
