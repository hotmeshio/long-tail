import * as scanCodeService from '../../services/scan-code';
import { accumulateItemByMetadata } from '../escalations/accumulate';
import {
  SCAN_OUTCOMES,
  type LTEscalationRecord,
  type ScanExecuteResponse,
  type ScanStep,
} from '../../types';
import type { LTApiResult } from '../../types/sdk';
import {
  conflict,
  executed,
  forbidden,
  interpolatedMetadata,
  provenance,
  refused,
  templated,
  type StepContext,
} from './context';
import { spendGrant } from './grant';
import { locateForStep } from './locate';
import { accumulateFromSubject } from './verbs-subject';
import { accumulateIntoSubject } from './verb-into-subject';

/**
 * Adds the scanned item to an accumulator. Two modes, one atomic write:
 *
 * - Item-locate (`params.accumulate.containerFacet`): the scan locates the
 *   item's own pending row through the scheme facet, reads the container
 *   facet value it carries, and adds the target to the container that shares
 *   it, writing the item row as the reciprocal in the same statement. An
 *   item with no row, or no container facet, falls through. An item whose
 *   container has closed and whose successor has not parked yet answers
 *   `no_open_container` with the item row, so the station can say "scan
 *   again" instead of showing the item with no hint.
 * - Container-locate (no `containerFacet`): the scan locates the container
 *   by the scheme facet and adds `params.itemKey` (template).
 *
 * Templates may read `{claim.<facet>}` (the actor's live claim) and, in item
 * mode, `{item.<facet>}` (the located row); an unresolvable token falls
 * through. The write is the SDK's guarded statement; the locate only picks
 * ids. A container already holding the item answers conflict, never a
 * second add.
 */
export async function accumulateStep(
  step: ScanStep,
  ctx: StepContext,
): Promise<LTApiResult<ScanExecuteResponse> | null> {
  const options = step.params?.accumulate;
  if (options?.from === 'subject') return accumulateFromSubject(step, ctx);
  if (options?.into === 'subject') return accumulateIntoSubject(step, ctx);
  let item: LTEscalationRecord | undefined;
  if (options?.containerFacet) {
    const located = await locateForStep(step, ctx, 1);
    item = located?.escalations[0];
    if (!item) return null;
  }
  const rendered = await templated(step, ctx, (tpl) => ({
    payload: step.params?.resolverPayload
      ? scanCodeService.interpolateScanTemplate(step.params.resolverPayload, tpl)
      : undefined,
    metadata: { ...interpolatedMetadata(step, ctx, tpl), ...provenance(ctx) },
    itemKey: options?.containerFacet
      ? ctx.parsed.target
      : scanCodeService.interpolateScanTemplate(step.params!.itemKey!, tpl),
  }), item);
  if (rendered === null) return null;

  let request: Parameters<typeof accumulateItemByMetadata>[0];
  let container: { facet: string; value: string } | undefined;
  if (options?.containerFacet && item) {
    const containerValue = (item.metadata as Record<string, any> | null)?.[options.containerFacet];
    if (containerValue === undefined || containerValue === null || containerValue === '') return null;
    container = { facet: options.containerFacet, value: String(containerValue) };
    request = {
      key: container.facet,
      value: container.value,
      itemKey: rendered.itemKey,
      payload: rendered.payload,
      metadata: rendered.metadata,
      restrictRoles: options.container?.roles ?? options.containerRoles,
      container: options.container
        ? { types: options.container.types, subtypes: options.container.subtypes, facets: options.container.facets }
        : undefined,
      ...(options.reciprocal === false ? {} : { reciprocal: { id: item.id } }),
    };
  } else {
    request = {
      key: ctx.scheme.target_facet,
      value: ctx.parsed.target,
      itemKey: rendered.itemKey,
      payload: rendered.payload,
      metadata: rendered.metadata,
      restrictRoles: step.query?.roles,
      ...(step.query?.types || step.query?.subtypes
        ? { container: { types: step.query.types, subtypes: step.query.subtypes } }
        : {}),
    };
  }

  const notPrimed = await spendGrant(ctx);
  if (notPrimed) return notPrimed;
  const result = await accumulateItemByMetadata(request, ctx.auth);
  if (result.status === 404) {
    if (!container || !item) return null;
    return {
      status: 200,
      data: {
        outcome: SCAN_OUTCOMES.NO_OPEN_CONTAINER,
        verb: step.verb,
        escalation: item,
        container,
        fallback: ctx.rule.fallback,
        error: `No open container carries ${container.facet} = ${container.value}`,
      },
    };
  }
  if (result.status === 403) return forbidden(result.error);
  if (result.status === 409) return conflict(result.error);
  if (result.status === 400 || result.status === 422) return refused(result.error ?? 'the item was not accepted');
  if (result.status !== 200) return result;
  const escalation = result.data.escalationId ? { id: result.data.escalationId, ...result.data } : undefined;
  return executed(escalation, step);
}
