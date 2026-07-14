/**
 * Policy-document activities — turn a resolved revision into the metadata the
 * NEXT revision's escalation carries, so the list view always reads the current
 * policy off the live row's metadata.
 */

import type { PolicyResolverV1 } from './forms';

export interface RevisionMetadata {
  title: string;
  owner: string;
  revision: number;
  effective_date: string;
  document_markdown: string;
}

/**
 * Fold a member's resolution into the next revision's metadata. Missing fields
 * carry over from the prior revision so a partial edit still yields a coherent
 * policy.
 */
export async function nextRevisionMetadata(input: {
  resolved: PolicyResolverV1;
  prior: RevisionMetadata;
}): Promise<RevisionMetadata> {
  const policy = input.resolved.policy ?? ({} as PolicyResolverV1['policy']);
  return {
    title: policy.title || input.prior.title,
    owner: policy.owner || input.prior.owner,
    revision: input.prior.revision + 1,
    effective_date: policy.effectiveDate || input.prior.effective_date,
    document_markdown: policy.document || input.prior.document_markdown,
  };
}
