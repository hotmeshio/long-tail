import * as domainService from '../services/domain';
import type { DomainDictionary } from '../types';
import type { LTApiResult } from '../types/sdk';

/**
 * The domain dictionary — read for everyone authenticated, replaced by admins.
 * GET returns `{ doc, version, updated_at }` or `{ doc: null }` when no
 * dictionary is registered. PUT validates references against the live
 * registries: unknown roles/workflows → 422 with the offending names; facet
 * warnings ride a successful response.
 */
export async function getDomain(): Promise<LTApiResult> {
  try {
    const record = await domainService.getDomainDictionary();
    return { status: 200, data: record ?? { doc: null } };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}

export async function putDomain(input: {
  doc: DomainDictionary;
  expected_version?: number;
}): Promise<LTApiResult> {
  try {
    if (!input?.doc || typeof input.doc !== 'object') {
      return { status: 400, error: 'body must be { doc, expected_version? }' };
    }
    const result = await domainService.putDomainDictionary(input.doc, input.expected_version);
    if (!result.ok) {
      if (result.reason === 'version_conflict') {
        return { status: 409, error: 'version conflict — reload and retry' };
      }
      return {
        status: 422,
        error: 'dictionary references unknown roles/workflows',
        data: { errors: result.errors, warnings: result.warnings },
      };
    }
    return { status: 200, data: { version: result.version, warnings: result.warnings } };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}
