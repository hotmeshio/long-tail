/**
 * machineUnitRoute: one set of units through the line. Each hop parks a
 * handoff row for the receiver; a machine resolves it over MQTT through the
 * gateway, a person resolves the last one on the dashboard. A hop that ends
 * without a receipt parks a line-operator row: retry the hop, finish the
 * units by hand, or scrap them. Units the sender finished as not ok are off
 * the line, so their row offers only manual and scrap.
 */

import { conditional, conditionalAccumulator } from '../../../../services/orchestrator/condition';
import { DECISION, LINE_ROLE, ROW_TYPE, handoffDecisions, signalKeys, type OperatorResolution } from '../../../../services/machines/contracts';
import type { LTEnvelope } from '../../../../types';
import {
  UNIT_ROUTE_WORKFLOW, hopFacets, hopRow, isMachineStep, planHops, readHopOutcome, type Hop, type HopOutcome, type RouteStep, type UnitRouteInput,
} from './route';

export { UNIT_ROUTE_WORKFLOW };

const DEFAULT_HANDOFF_TIMEOUT = '30m';
const OPERATOR_TIMEOUT = '7d';

async function handoff(input: UnitRouteInput, hop: Hop, attempt: number, senderAttempt: number): Promise<HopOutcome> {
  const row = hopRow(input, hop, attempt, senderAttempt);
  const result = await conditionalAccumulator(signalKeys.handoff(input.routeKey, hop.index, attempt), {
    ...row,
    priority: 2,
    workflowType: UNIT_ROUTE_WORKFLOW,
    accumulate: {},
    timeout: input.handoffTimeout ?? DEFAULT_HANDOFF_TIMEOUT,
  });
  return readHopOutcome(result as Record<string, any> | null);
}

/** Ask until the operator picks one of the decisions this failure allows. */
async function askOperator(input: UnitRouteInput, hop: Hop, attempt: number, senderAttempt: number, outcome: HopOutcome): Promise<OperatorResolution> {
  const where = stationName(hop.from, 'line entry');
  const decisions = handoffDecisions(outcome.errorCode);
  let refused = '';
  for (let round = 1; ; round++) {
    const answer = await conditional<OperatorResolution>(signalKeys.handoffError(input.routeKey, hop.index, attempt, round), {
      role: LINE_ROLE.OPERATOR,
      type: ROW_TYPE.HANDOFF_ERROR,
      subtype: outcome.errorCode,
      description: `${refused}${input.units.map((u) => u.unitId).join(', ')} stopped at ${where}: ${outcome.errorCode}. ${outcome.detail ?? ''} Choose ${decisions.join(', ')}.`.replace(/\s+/g, ' ').trim(),
      priority: 1,
      workflowType: UNIT_ROUTE_WORKFLOW,
      metadata: {
        ...hopFacets(input, hop, attempt, senderAttempt), errorCode: outcome.errorCode, detail: outcome.detail ?? null, decisions, round,
      } as Record<string, unknown>,
      timeout: input.operatorTimeout ?? OPERATOR_TIMEOUT,
    });
    if (!answer) return { decision: DECISION.SCRAP, note: 'no decision before the timeout' };
    if (decisions.includes(answer.decision)) return answer;
    refused = `${answer.decision} is not available here. `;
  }
}

function stationName(step: RouteStep | null, end = 'exit'): string {
  if (!step) return end;
  return isMachineStep(step) ? step.machineId : step.role;
}

export async function machineUnitRoute(envelope: LTEnvelope): Promise<any> {
  const input = envelope.data as UnitRouteInput;
  const hops = planHops(input.steps);
  const history: Record<string, any>[] = [];

  // The attempt that brought the units to the current sender: its job is the one to release them.
  let senderAttempt = 1;
  for (const hop of hops) {
    for (let attempt = 1; ; attempt++) {
      const outcome = await handoff(input, hop, attempt, senderAttempt);
      history.push({ hop: hop.index, to: stationName(hop.to), attempt, ...outcome });
      if (outcome.received) {
        senderAttempt = attempt;
        break;
      }
      const { decision, note } = await askOperator(input, hop, attempt, senderAttempt, outcome);
      if (decision === DECISION.RETRY) continue;
      if (decision === DECISION.MANUAL) {
        // The units leave automation; a person takes them from where they stopped.
        const exit: Hop = { index: hops.length, from: hop.from, to: null };
        const manual = await handoff(input, exit, 1, senderAttempt);
        return { type: 'return' as const, data: { status: 'manual', at: stationName(hop.from, 'entry'), received: manual.received, note, history } };
      }
      return { type: 'return' as const, data: { status: 'scrapped', at: stationName(hop.from, 'entry'), note, history } };
    }
  }
  return { type: 'return' as const, data: { status: 'complete', units: input.units.map((u) => u.unitId), history } };
}
