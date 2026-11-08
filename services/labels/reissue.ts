// Reissue a badge: rotate the user's credential and print the new badge in
// one act. The rotation and its ledger row land in one statement, so the old
// code stops resolving the moment the new one exists.

import { SCAN_SCHEME_KINDS } from '../../types';
import type { LTApiAuth } from '../../types/sdk';
import type { LabelLayoutRequest } from '../../types/labels';
import { getScanScheme } from '../scan-code';
import { getUser, patchUserPropertiesRecorded, type PropertyPatchRecord } from '../user';
import { LabelRequestError } from './errors';
import { issueLabels, assertMayPrint, type LabelIssueResult } from './issue';
import { mediaForJob } from './media';
import { getLabelTemplate } from './templates';
import { mintIdentityToken } from './token';

export interface ReissueRequest {
  userId: string;
  template: string;
  layout?: LabelLayoutRequest;
  output: 'sheet' | 'pdf' | 'zpl' | `transport:${string}`;
  confirm?: boolean;
}

/** The rotation and its ledger row in one statement; a refused patch becomes a label request error. */
async function rotate(userId: string, set: Record<string, string>, record: PropertyPatchRecord) {
  try {
    return await patchUserPropertiesRecorded(userId, { set }, record);
  } catch (err: any) {
    if (err?.status === 400 || err?.status === 409) throw new LabelRequestError(err.status, err.message);
    throw err;
  }
}

export async function reissueBadge(req: ReissueRequest, auth: LTApiAuth): Promise<LabelIssueResult & { reissueJobId: string }> {
  const template = await getLabelTemplate(req.template);
  if (!template) throw new LabelRequestError(404, `label template "${req.template}" does not exist`);
  const scheme = await getScanScheme(template.scheme_version);
  if (!scheme || scheme.kind !== SCAN_SCHEME_KINDS.IDENTITY) {
    throw new LabelRequestError(400, 'reissue needs a template on an identity scheme');
  }
  await assertMayPrint(true, auth);
  if (req.confirm !== true) throw new LabelRequestError(428, 'reissuing a badge replaces the old one; confirm to reissue');
  const user = await getUser(req.userId);
  if (!user) throw new LabelRequestError(404, 'user not found');

  const media = mediaForJob(req.layout?.media, template.media);
  const rotated = await rotate(user.id, { [scheme.target_facet]: mintIdentityToken(scheme) }, {
    action: 'reissue',
    requested_by: auth.userId,
    require_active: true,
    source: { keys: [scheme.target_facet] },
    label_count: 1,
    template_name: template.name,
    template_revision: template.revision,
    template_snapshot: template,
    scheme_version: scheme.version,
    scheme_kind: scheme.kind,
    media,
    output: req.output,
  });
  if (!rotated) throw new LabelRequestError(404, 'user not found');

  const printed = await issueLabels({
    template: template.name,
    source: { kind: 'users', userIds: [user.id] },
    layout: req.layout,
    output: req.output,
    confirm: true,
  }, auth);
  return { ...printed, reissueJobId: rotated.jobId };
}
