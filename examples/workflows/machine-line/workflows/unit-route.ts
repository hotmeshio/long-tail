/**
 * machineUnitRoute: one set of units through the line. Each hop parks a
 * handoff row for the receiver; a machine resolves it over MQTT through the
 * gateway, a person resolves the last one on the dashboard. A hop that ends
 * without a receipt parks a line-operator row: retry the hop, finish the
 * units by hand, or scrap them. Units the sender finished as not ok are off
 * the line, and units split by a partial arrival are no longer all at the
 * sender, so those rows offer only manual and scrap.
 *
 * What to do with split units is this workflow's policy, not the platform's:
 * it withdraws the receiver's job through a machine-command row (`cancel`: the
 * job never started, since not every unit arrived), so the units that arrived
 * come to rest, and a person collects each group where it stopped. A cancelled
 * handoff stops the sender's started job the same way (`stop` with the job).
 *
 * Units a machine finished on hold wait for the quality role: release runs
 * the hop again from the holding machine, rework runs the route again from a
 * station it names (the holding machine by default), scrap ends the route.
 * When the line's codec declares a disposition command, the decision is also
 * sent to the holding machine as a command row on its role.
 */

import { conditional, conditionalAccumulator } from '../../../../services/orchestrator/condition';
import {
  DECISION, HANDOFF_ERROR, HOLD_DECISIONS, LINE_ROLE, ROW_TYPE, handoffDecisions, signalKeys,
  type HandoffUnit, type OperatorResolution, type QualityResolution,
} from '../../../../services/machines/contracts';
import { commandRow } from '../../../../services/machines/commands';
import { JOB_RESULT, OP } from '../../../../lib/machines/protocol';
import type { LTEnvelope } from '../../../../types';
import {
  UNIT_ROUTE_WORKFLOW, hopFacets, hopRow, isMachineStep, jobIdFor, pickupRow, planHops, readHopOutcome, reworkHop, roleOf,
  type Hop, type HopOutcome, type RouteStep, type UnitRouteInput,
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
  return readHopOutcome(result as Record<string, any> | null, input.units.map((u) => u.unitId));
}

/** End a station's job for the route through a command row on its role: `stop` for started work, `cancel` for a job still queued. */
async function stopJob(input: UnitRouteInput, hop: Hop, attempt: number, step: RouteStep | null, jobAttempt: number, op: typeof OP.STOP | typeof OP.CANCEL): Promise<void> {
  if (!isMachineStep(step)) return;
  const target = { siteId: input.siteId, lineId: input.lineId, machineId: step.machineId, role: roleOf(input, step) };
  await conditional(signalKeys.jobStop(input.routeKey, hop.index, attempt), {
    ...commandRow(target, op, { jobId: jobIdFor(input.routeKey, step, jobAttempt) }),
    workflowType: UNIT_ROUTE_WORKFLOW,
  });
}

/** Units split by a partial arrival: one group at the receiver, the rest where the hop started. */
function splitGroups(input: UnitRouteInput, hop: Hop, outcome: HopOutcome): { at: RouteStep; units: HandoffUnit[] }[] {
  const of = (ids: string[] = []) => input.units.filter((u) => ids.includes(u.unitId));
  return [{ at: hop.to!, units: of(outcome.arrived) }, ...(hop.from ? [{ at: hop.from, units: of(outcome.missing) }] : [])]
    .filter((g) => g.units.length);
}

/** A person collects each group where it stopped; the route ends once every group is off the line. */
async function collectSplit(input: UnitRouteInput, firstIndex: number, groups: { at: RouteStep; units: HandoffUnit[] }[]) {
  const rows = groups.map((g, i) => conditionalAccumulator(signalKeys.handoff(input.routeKey, firstIndex + i, 1), {
    ...pickupRow(input, firstIndex + i, g.at, g.units), priority: 2, workflowType: UNIT_ROUTE_WORKFLOW, accumulate: {},
  }));
  const results = await Promise.all(rows);
  return groups.map((g, i) => ({ at: stationName(g.at), units: g.units.map((u) => u.unitId), received: results[i]?.received === true }));
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

/** Ask the quality role what to do with units the sender finished on hold. */
async function askQuality(input: UnitRouteInput, hop: Hop, attempt: number, senderAttempt: number, outcome: HopOutcome): Promise<QualityResolution> {
  const where = stationName(hop.from, 'line entry');
  let refused = '';
  for (let round = 1; ; round++) {
    const answer = await conditional<QualityResolution>(signalKeys.hold(input.routeKey, hop.index, attempt, round), {
      role: input.qualityRole ?? LINE_ROLE.QUALITY,
      type: ROW_TYPE.QUALITY_HOLD,
      subtype: JOB_RESULT.HOLD,
      description: `${refused}${input.units.map((u) => u.unitId).join(', ')} held at ${where}. ${outcome.detail ?? ''} Choose ${HOLD_DECISIONS.join(', ')}.`.replace(/\s+/g, ' ').trim(),
      priority: 1,
      workflowType: UNIT_ROUTE_WORKFLOW,
      metadata: {
        ...hopFacets(input, hop, attempt, senderAttempt), errorCode: outcome.errorCode, result: outcome.result, detail: outcome.detail ?? null, decisions: HOLD_DECISIONS, round,
      } as Record<string, unknown>,
      timeout: input.operatorTimeout ?? OPERATOR_TIMEOUT,
    });
    if (!answer) return { decision: DECISION.SCRAP, note: 'no decision before the timeout' };
    if (HOLD_DECISIONS.includes(answer.decision)) return answer;
    refused = `${answer.decision} is not available here. `;
  }
}

/** Tell the holding machine the decision, when its codec has a command for it. */
async function sendDisposition(input: UnitRouteInput, hop: Hop, attempt: number, senderAttempt: number, quality: QualityResolution): Promise<void> {
  if (!input.dispositionOp || !isMachineStep(hop.from)) return;
  const target = { siteId: input.siteId, lineId: input.lineId, machineId: hop.from.machineId, role: roleOf(input, hop.from) };
  const args = { jobId: jobIdFor(input.routeKey, hop.from, senderAttempt), unitIds: input.units.map((u) => u.unitId), decision: quality.decision, note: quality.note ?? null };
  await conditional(signalKeys.disposition(input.routeKey, hop.index, attempt), {
    ...commandRow(target, input.dispositionOp, args),
    workflowType: UNIT_ROUTE_WORKFLOW,
  });
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
  // Every attempt of a hop mints a fresh signal key, across reruns of the hop after a rework.
  const attempts = new Map<number, number>();
  const nextAttempt = (hop: Hop) => {
    const n = (attempts.get(hop.index) ?? 0) + 1;
    attempts.set(hop.index, n);
    return n;
  };
  for (let h = 0; h < hops.length; ) {
    const hop = hops[h];
    let next = h + 1;
    for (;;) {
      const attempt = nextAttempt(hop);
      const outcome = await handoff(input, hop, attempt, senderAttempt);
      history.push({ hop: hop.index, to: stationName(hop.to), attempt, ...outcome });
      if (outcome.received) {
        senderAttempt = attempt;
        break;
      }
      if (outcome.errorCode === HANDOFF_ERROR.SENDER_REJECTED && outcome.result === JOB_RESULT.HOLD && hop.from) {
        const quality = await askQuality(input, hop, attempt, senderAttempt, outcome);
        await sendDisposition(input, hop, attempt, senderAttempt, quality);
        history.push({ hop: hop.index, held: true, decision: quality.decision, station: quality.station ?? null });
        if (quality.decision === DECISION.RELEASE) continue;
        if (quality.decision === DECISION.REWORK) {
          // The units run again from the station named, carried there from the holding machine.
          const again = reworkHop(hops, hop, quality.station);
          if (again.index === hop.index) continue;
          hops[again.index] = { ...again, from: hop.from };
          next = again.index;
          break;
        }
        return { type: 'return' as const, data: { status: 'scrapped', at: stationName(hop.from, 'entry'), note: quality.note, history } };
      }
      // The sender's job is started work: its units are there. The receiver's never started: not every unit arrived.
      if (outcome.errorCode === HANDOFF_ERROR.CANCELLED) await stopJob(input, hop, attempt, hop.from, senderAttempt, OP.STOP);
      const { decision, note } = await askOperator(input, hop, attempt, senderAttempt, outcome);
      if (decision === DECISION.RETRY) continue;
      if (outcome.errorCode === HANDOFF_ERROR.PARTIAL_ARRIVAL && hop.to) {
        await stopJob(input, hop, attempt, hop.to, attempt, OP.CANCEL);
        if (decision === DECISION.SCRAP) return { type: 'return' as const, data: { status: 'scrapped', at: stationName(hop.from, 'entry'), note, history } };
        const pickups = await collectSplit(input, hops.length, splitGroups(input, hop, outcome));
        return { type: 'return' as const, data: { status: 'manual', at: stationName(hop.from, 'entry'), received: pickups.every((p) => p.received), pickups, note, history } };
      }
      if (decision === DECISION.MANUAL) {
        // The units leave automation; a person takes them from where they stopped.
        const exit: Hop = { index: hops.length, from: hop.from, to: null };
        const manual = await handoff(input, exit, 1, senderAttempt);
        return { type: 'return' as const, data: { status: 'manual', at: stationName(hop.from, 'entry'), received: manual.received, note, history } };
      }
      return { type: 'return' as const, data: { status: 'scrapped', at: stationName(hop.from, 'entry'), note, history } };
    }
    h = next;
  }
  return { type: 'return' as const, data: { status: 'complete', units: input.units.map((u) => u.unitId), history } };
}
