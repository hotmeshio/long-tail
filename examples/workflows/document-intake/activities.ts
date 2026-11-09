import { createClient } from '../../../sdk';
import { differsFromProposal } from '../../../shared/form-validation/x-lt-confidence';
import type { EscalationFileRef } from '../../../types/escalation';
import { buildApplicationPdf, buildIdCardSvg } from './sample-documents';
import type { IntakeReviewV1 } from './forms';

const STORAGE_PREFIX = 'examples/document-intake';

/**
 * Store the application and ID card the review shows. A deployment receives
 * these from intake (upload, email, fax); the example writes its samples.
 * Writing the same key twice stores the same bytes, so a retry is harmless.
 */
export async function stageSampleDocuments(applicationId: string): Promise<EscalationFileRef[]> {
  const lt = createClient({ auth: { userId: 'lt-system' } });
  const base = `${STORAGE_PREFIX}/${applicationId}`;
  const uploads: Array<[string, Buffer]> = [
    [`${base}/application.pdf`, await buildApplicationPdf(applicationId)],
    [`${base}/id-card.svg`, buildIdCardSvg()],
  ];
  for (const [path, buffer] of uploads) {
    const stored = await lt.files.upload({ path, buffer });
    if (stored.status !== 200) throw new Error(`Storing ${path} failed: ${stored.error}`);
  }
  return [
    { path: `${base}/application.pdf`, as: 'application', name: `Application ${applicationId}.pdf` },
    { path: `${base}/id-card.svg`, as: 'id_card', name: 'ID card' },
  ];
}

/** The model and version that read the documents, recorded on the row so reports can compare versions. */
export const INTAKE_EXTRACTOR = 'intake-extractor-v1';

export interface Extraction {
  extractor: string;
  values: Record<string, unknown>;
  confidence: Record<string, unknown>;
}

/**
 * What a document model returns: proposed values and a score per value, in
 * the payload's shape. The example answers as a model would for its sample,
 * with the misreads a person must catch: a first name read short, a day and
 * month swapped, the wrong account box.
 */
export async function extractApplication(_applicationId: string): Promise<Extraction> {
  return {
    extractor: INTAKE_EXTRACTOR,
    values: {
      applicant: {
        first_name: 'Jon',
        last_name: 'Okafor',
        date_of_birth: '1987-03-04',
        email: 'john.okafor@example.com',
        phone: '(503) 555-0142',
      },
      account_type: 'individual',
      address: { street: '41 Harbor Lane', city: 'Portland', postal_code: '97205' },
    },
    confidence: {
      applicant: { first_name: 0.52, last_name: 0.97, date_of_birth: 0.58, email: 0.93, phone: 0.71 },
      account_type: 0.66,
      address: { street: 0.9, city: 0.96, postal_code: 0.83 },
    },
  };
}

export interface Correction {
  path: string;
  proposed: unknown;
  final: unknown;
}

function leaves(value: unknown, prefix = ''): Array<[string, unknown]> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return Object.entries(value as Record<string, unknown>)
      .flatMap(([k, v]) => leaves(v, prefix ? `${prefix}.${k}` : k));
  }
  return [[prefix, value]];
}

function valueAt(root: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((node, key) =>
    node && typeof node === 'object' ? (node as Record<string, unknown>)[key] : undefined, root);
}

/**
 * Record the verified application and every value the reviewer corrected,
 * the feedback a model's next round learns from.
 */
export async function recordReview(input: { proposed: Record<string, unknown>; review: IntakeReviewV1 }) {
  const corrections: Correction[] = leaves(input.proposed)
    .map(([path, proposed]) => ({ path, proposed, final: valueAt(input.review, path) }))
    .filter((c) => differsFromProposal(c.proposed, c.final));
  return {
    accepted: input.review.id_matches === 'yes',
    applicant: input.review.applicant,
    corrections,
    proposedCount: leaves(input.proposed).length,
    recordedAt: new Date().toISOString(),
  };
}
