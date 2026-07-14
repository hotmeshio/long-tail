/**
 * Policy Document Workflow — the reference example for the role-owned, versioned
 * LIST view.
 *
 * The workflow is a loop: it opens ONE policy-review escalation to the
 * `policy-document` role and parks on it (conditionLT). A member claims and
 * publishes a revision; the workflow folds that into the next revision's
 * metadata and opens the next escalation. So at any moment exactly ONE policy is
 * live (pending), and every resolved revision is the audit trail — which is why
 * the list needs a schema: a list of one is a document, not a table row.
 *
 * The policy facts (title, owner, revision, effective date, and the document
 * markdown itself) ride the escalation's metadata, so the list_schema reads them
 * off the live row with `{{metadata.*}}` tokens with no second lookup. The edit
 * form is pinned to POLICY_SCHEMA_VERSION; the list view always renders latest.
 */

import { Durable } from '@hotmeshio/hotmesh';

import type { LTEnvelope } from '../../../types';
import { conditionLT } from '../../../services/orchestrator/condition';
import * as activities from './activities';
import type { RevisionMetadata } from './activities';
import {
  POLICY_ROLE,
  POLICY_SCHEMA_VERSION,
  INITIAL_POLICY_MARKDOWN,
  type PolicyResolverV1,
} from './forms';

type ActivitiesType = typeof activities;

/** Bounded high enough that the queue always shows one live policy in a demo. */
const MAX_REVISIONS = 50;

export async function policyDocument(envelope: LTEnvelope): Promise<any> {
  const { role = POLICY_ROLE, title = 'Refund Policy', owner = 'Legal' } = envelope.data ?? {};

  const { nextRevisionMetadata } = Durable.workflow.proxyActivities<ActivitiesType>({ activities });

  const ctx = Durable.workflow.workflowInfo();

  let meta: RevisionMetadata = {
    title,
    owner,
    revision: 1,
    effective_date: '2026-08-01',
    document_markdown: INITIAL_POLICY_MARKDOWN,
  };

  for (let rev = 1; rev <= MAX_REVISIONS; rev++) {
    const signalId = `policy-${ctx.workflowId}-${rev}`;

    // Seed the edit form from the current policy so the member revises in place.
    const formDefaults: PolicyResolverV1 = {
      policy: {
        title: meta.title,
        effectiveDate: meta.effective_date,
        owner: meta.owner,
        document: meta.document_markdown,
      },
      approved: false,
    };

    // Open the live policy escalation and park. The policy facts ride the
    // metadata so the list view reads them straight off the row.
    const response = await conditionLT<PolicyResolverV1>(signalId, {
      role,
      type: 'policy-review',
      subtype: 'revision',
      priority: 2,
      description: `Review and revise "${meta.title}" (revision ${meta.revision}).`,
      workflowType: 'policyDocument',
      metadata: {
        title: meta.title,
        owner: meta.owner,
        revision: meta.revision,
        effective_date: meta.effective_date,
        document_markdown: meta.document_markdown,
      },
      envelope: { source: 'policy-document', formDefaults },
      schemaVersion: POLICY_SCHEMA_VERSION,
    });

    if (!response) {
      return { type: 'return' as const, data: { cancelled: true, atRevision: meta.revision } };
    }

    // Fold the resolution into the next revision and loop.
    meta = await nextRevisionMetadata({ resolved: response, prior: meta });
  }

  return { type: 'return' as const, data: { done: true, revisions: meta.revision } };
}
