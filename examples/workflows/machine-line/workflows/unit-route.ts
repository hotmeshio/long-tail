/**
 * machineUnitRoute: one set of units through the line. Each hop parks a
 * handoff row for the receiver; a machine resolves it over MQTT through the
 * gateway, a person resolves the last one on the dashboard. A hop that ends
 * without a receipt parks a line-operator row: retry the hop, finish the
 * units by hand, or scrap them.
 */

import { conditional, conditionalAccumulator } from '../../../../services/orchestrator/condition';
import { DECISION, LINE_ROLE, ROW_TYPE, signalKeys, type OperatorResolution } from '../contracts';
import type { LTEnvelope } from '../../../../types';
import { hopFacets, hopRow, planHops, readHopOutcome, type Hop, type HopOutcome, type UnitRouteInput } from './route';

export const UNIT_ROUTE_WORKFLOW = 'machineUnitRoute';

const DEFAULT_HANDOFF_TIMEOUT = '30m';
const OPERATOR_TIMEOUT = '7d';

async function handoff(input: UnitRouteInput, hop: Hop, attempt: number): Promise<HopOutcome> {
  const row = hopRow(input, hop, attempt);
  const result = await conditionalAccumulator(signalKeys.handoff(input.routeKey, hop.index, attempt), {
    ...row,
    priority: 2,
    workflowType: UNIT_ROUTE_WORKFLOW,
    accumulate: {},
    timeout: input.handoffTimeout ?? DEFAULT_HANDOFF_TIMEOUT,
  });
  return readHopOutcome(result as Record<string, any> | null);
}

async function askOperator(input: UnitRouteInput, hop: Hop, attempt: number, outcome: HopOutcome): Promise<OperatorResolution> {
  const where = hop.from?.machineId ?? 'line entry';
  const decision = await conditional<OperatorResolution>(signalKeys.handoffError(input.routeKey, hop.index, attempt), {
    role: LINE_ROLE.OPERATOR,
    type: ROW_TYPE.HANDOFF_ERROR,
    subtype: outcome.errorCode,
    description: `${input.units.map((u) => u.unitId).join(', ')} stopped at ${where}: ${outcome.errorCode}. ${outcome.detail ?? ''}`.trim(),
    priority: 1,
    workflowType: UNIT_ROUTE_WORKFLOW,
    metadata: { ...hopFacets(input, hop, attempt), errorCode: outcome.errorCode, detail: outcome.detail ?? null } as Record<string, unknown>,
    timeout: OPERATOR_TIMEOUT,
  });
  return decision || { decision: DECISION.SCRAP, note: 'no decision before the timeout' };
}

export async function machineUnitRoute(envelope: LTEnvelope): Promise<any> {
  const input = envelope.data as UnitRouteInput;
  const hops = planHops(input.steps);
  const history: Record<string, any>[] = [];

  for (const hop of hops) {
    for (let attempt = 1; ; attempt++) {
      const outcome = await handoff(input, hop, attempt);
      history.push({ hop: hop.index, to: hop.to?.machineId ?? 'exit', attempt, ...outcome });
      if (outcome.received) break;
      const { decision, note } = await askOperator(input, hop, attempt, outcome);
      if (decision === DECISION.RETRY) continue;
      if (decision === DECISION.MANUAL) {
        // The units leave automation; a person takes them from where they stopped.
        const exit: Hop = { index: hops.length, from: hop.from, to: null };
        const manual = await handoff(input, exit, 1);
        return { type: 'return' as const, data: { status: 'manual', at: hop.from?.machineId ?? 'entry', received: manual.received, note, history } };
      }
      return { type: 'return' as const, data: { status: 'scrapped', at: hop.from?.machineId ?? 'entry', note, history } };
    }
  }
  return { type: 'return' as const, data: { status: 'complete', units: input.units.map((u) => u.unitId), history } };
}
