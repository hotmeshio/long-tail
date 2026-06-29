import * as escalationService from '../../services/escalation';
import {
  ATTAINMENT_RANGES,
  isAttainmentRange,
  isServicerCohort,
} from '../../services/escalation';
import type { AttainmentRangeKey, ReadScope, ServicerCohort } from '../../services/escalation';
import { getEscalationReadScope, getEscalationWriteScope } from './helpers';
import type { FacetQuery } from '../../types';
import type { LTApiAuth, LTApiResult } from '../../types/sdk';

const RANGE_HELP = `range must be one of: ${Object.keys(ATTAINMENT_RANGES).join(', ')}`;

/** Build the read-scope passed to the service so visibility is folded into SQL. */
function readScopeFor(
  scope: { global: boolean; allRoles: string[]; selfRoles: string[] },
  userId: string,
): ReadScope {
  return {
    global: scope.global,
    visibleRoles: scope.allRoles,
    selfRoles: scope.selfRoles,
    meUserId: userId,
  };
}

export interface AttainmentApiInput {
  role: string;
  range: AttainmentRangeKey | string;
  nowEpoch?: number;
  stationFacet?: string;
  unitFacet?: string | null;
  facet?: FacetQuery;
}

/**
 * Role lens — per-station attainment over time. Manager view: requires read-all
 * on the role (or global). read-self memberships get the queue, not the overview.
 */
export async function getAttainment(
  input: AttainmentApiInput,
  auth: LTApiAuth,
): Promise<LTApiResult> {
  try {
    if (!input.role) return { status: 400, error: 'role is required' };
    if (!isAttainmentRange(input.range)) return { status: 400, error: RANGE_HELP };

    const scope = await getEscalationReadScope(auth.userId);
    if (!scope.global && !scope.allRoles.includes(input.role)) {
      return { status: 403, error: `You need read-all access to the "${input.role}" role to view its overview` };
    }

    const buckets = await escalationService.computeAttainment({
      role: input.role,
      range: input.range,
      nowEpoch: input.nowEpoch,
      stationFacet: input.stationFacet,
      unitFacet: input.unitFacet,
      facet: input.facet,
      scope: readScopeFor(scope, auth.userId),
    });
    return { status: 200, data: { buckets } };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}

/**
 * Servicer lens — per-identity (or per cohort) scorecard. Same manager gate;
 * per-identity profiling is never exposed to read-self members.
 */
export async function getServicerProfile(
  input: AttainmentApiInput & { assignedTo?: string; cohortBy?: ServicerCohort | string },
  auth: LTApiAuth,
): Promise<LTApiResult> {
  try {
    if (!input.role) return { status: 400, error: 'role is required' };
    if (!isAttainmentRange(input.range)) return { status: 400, error: RANGE_HELP };
    if (input.cohortBy != null && !isServicerCohort(input.cohortBy)) {
      return { status: 400, error: 'cohortBy must be: account_type' };
    }

    const scope = await getEscalationReadScope(auth.userId);
    if (!scope.global && !scope.allRoles.includes(input.role)) {
      return { status: 403, error: `You need read-all access to the "${input.role}" role to view servicer performance` };
    }

    const servicers = await escalationService.computeServicerProfile({
      role: input.role,
      range: input.range,
      nowEpoch: input.nowEpoch,
      stationFacet: input.stationFacet,
      unitFacet: input.unitFacet,
      facet: input.facet,
      assignedTo: input.assignedTo,
      cohortBy: isServicerCohort(input.cohortBy) ? input.cohortBy : undefined,
      scope: readScopeFor(scope, auth.userId),
    });
    return { status: 200, data: { servicers } };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}

/**
 * Freeze the current overview as an immutable baseline. Requires write-all on the
 * role (or global) — a baseline is a config act, not a read.
 */
export async function setBaseline(
  input: AttainmentApiInput & { label?: string },
  auth: LTApiAuth,
): Promise<LTApiResult> {
  try {
    if (!input.role) return { status: 400, error: 'role is required' };
    if (!isAttainmentRange(input.range)) return { status: 400, error: RANGE_HELP };

    const writeScope = await getEscalationWriteScope(auth.userId);
    if (!writeScope.global && !writeScope.allRoles.includes(input.role)) {
      return { status: 403, error: `You need write-all access to the "${input.role}" role to set a baseline` };
    }
    // write-all implies read-all (write ⊆ read), so read-scope folds in cleanly.
    const readScope = await getEscalationReadScope(auth.userId);

    const result = await escalationService.setBaseline({
      role: input.role,
      range: input.range,
      nowEpoch: input.nowEpoch,
      stationFacet: input.stationFacet,
      unitFacet: input.unitFacet,
      facet: input.facet,
      label: input.label,
      createdBy: auth.userId,
      scope: readScopeFor(readScope, auth.userId),
    });
    return { status: 201, data: result };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}

/** The most recent saved baseline for a role. Manager read gate. */
export async function getBaseline(
  input: { role: string },
  auth: LTApiAuth,
): Promise<LTApiResult> {
  try {
    if (!input.role) return { status: 400, error: 'role is required' };
    const scope = await getEscalationReadScope(auth.userId);
    if (!scope.global && !scope.allRoles.includes(input.role)) {
      return { status: 403, error: `You need read-all access to the "${input.role}" role` };
    }
    const baseline = await escalationService.getLatestBaseline(input.role);
    return { status: 200, data: { baseline } };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}

/** List a role's saved baselines (no snapshot payload). Manager read gate. */
export async function listBaselines(
  input: { role: string },
  auth: LTApiAuth,
): Promise<LTApiResult> {
  try {
    if (!input.role) return { status: 400, error: 'role is required' };
    const scope = await getEscalationReadScope(auth.userId);
    if (!scope.global && !scope.allRoles.includes(input.role)) {
      return { status: 403, error: `You need read-all access to the "${input.role}" role` };
    }
    const baselines = await escalationService.listBaselines(input.role);
    return { status: 200, data: { baselines } };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}
