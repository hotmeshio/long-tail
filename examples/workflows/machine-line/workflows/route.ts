/**
 * The pure part of the unit workflow: the hops a set of units takes along the
 * route, the row each hop parks, and what a finished row means.
 */

import { HANDOFF_ERROR, LINE_ROLE, ROW_TYPE, arrivedUnit, type HandoffErrorCode, type HandoffFacets, type HandoffUnit } from '../../../../services/machines/contracts';
import { machineById, machineRole, stationRole, type LineDef } from '../../../../lib/machines/line';

export const UNIT_ROUTE_WORKFLOW = 'machineUnitRoute';

/** A station a machine works: the gateway dispatches to it and resolves the handoff as it. */
export interface MachineStep {
  machineId: string;
  process: string;
  recipe: { id: string; version: string };
  /** The machine's role when the line names one; line-<process> otherwise. */
  role?: string;
}

/** A station people work: its handoff is resolved on the dashboard, like any form. */
export interface PersonStep {
  role: string;
}

export type RouteStep = MachineStep | PersonStep;

export function isMachineStep(step: RouteStep | null): step is MachineStep {
  return !!step && 'machineId' in step;
}

const stationKey = (step: RouteStep) => (isMachineStep(step) ? step.machineId : step.role);
const machineOf = (step: RouteStep | null) => (isMachineStep(step) ? step : null);

export interface UnitRouteInput {
  siteId: string;
  lineId: string;
  /** Names this set of units on the line; part of every job id and signal key. */
  routeKey: string;
  orderRef: string;
  units: HandoffUnit[];
  steps: RouteStep[];
  artifact?: { url: string; sha256: string };
  /** How long a handoff waits for its receipt before a person is asked. */
  handoffTimeout?: string;
  /** How long a failed handoff waits for the operator's decision before the units are scrapped. */
  operatorTimeout?: string;
  /** The role of the person who receives units at the end of the route; line-exit by default. */
  exitRole?: string;
}

/** Every machine on the line in order, each on its first recipe at the newest version. */
export function lineSteps(line: LineDef): RouteStep[] {
  return line.machines.map((m) => machineStep(line, m.machineId));
}

/** A machine on the line as a route step, on its first recipe at the newest version. */
export function machineStep(line: LineDef, machineId: string): MachineStep {
  const m = machineById(line, machineId);
  const [id, versions] = Object.entries(m.recipes)[0];
  return { machineId, process: m.process, recipe: { id, version: versions[versions.length - 1] }, role: machineRole(m) };
}

/** One move between stations: from line entry (null) through each step to line exit (null), where a person receives. */
export interface Hop {
  index: number;
  from: RouteStep | null;
  to: RouteStep | null;
}

export function planHops(steps: RouteStep[]): Hop[] {
  const stops: (RouteStep | null)[] = [null, ...steps, null];
  return stops.slice(1).map((to, i) => ({ index: i, from: stops[i], to }));
}

/** A station's job for a route; a retry is a new job, so nothing meant for the last attempt reaches it. */
export function jobIdFor(routeKey: string, step: RouteStep | null, attempt = 1): string {
  const base = `${routeKey}-${step ? stationKey(step) : 'exit'}`;
  return attempt > 1 ? `${base}-a${attempt}` : base;
}

/** `senderAttempt` is the attempt of the hop that brought the units to the sender. */
export function hopFacets(input: UnitRouteInput, hop: Hop, attempt: number, senderAttempt = 1): HandoffFacets {
  return {
    siteId: input.siteId,
    lineId: input.lineId,
    units: input.units,
    jobId: jobIdFor(input.routeKey, hop.to, attempt),
    senderJobId: hop.from ? jobIdFor(input.routeKey, hop.from, senderAttempt) : null,
    orderRef: input.orderRef,
    fromMachine: machineOf(hop.from)?.machineId ?? null,
    toMachine: machineOf(hop.to)?.machineId ?? null,
    recipeId: machineOf(hop.to)?.recipe.id ?? null,
    recipeVersion: machineOf(hop.to)?.recipe.version ?? null,
    process: machineOf(hop.to)?.process ?? null,
    artifactUrl: machineOf(hop.to) && input.artifact ? input.artifact.url : null,
    artifactSha256: machineOf(hop.to) && input.artifact ? input.artifact.sha256 : null,
    attempt,
  };
}

function roleOf(input: UnitRouteInput, step: RouteStep | null): string {
  if (!step) return input.exitRole ?? LINE_ROLE.EXIT;
  return isMachineStep(step) ? step.role ?? stationRole(step.process) : step.role;
}

/**
 * The row a hop parks, on the receiving station's role: a machine's role (its
 * gateway resolves it) or a person's (the dashboard does). The row is the same
 * either way; the workflow does not know which.
 */
export function hopRow(input: UnitRouteInput, hop: Hop, attempt: number, senderAttempt = 1) {
  const from = hop.from ? stationKey(hop.from) : 'line entry';
  const to = hop.to ? stationKey(hop.to) : 'line exit';
  const units = input.units.map((u) => u.unitId).join(', ');
  return {
    role: roleOf(input, hop.to),
    type: ROW_TYPE.HANDOFF,
    subtype: hop.to ? (isMachineStep(hop.to) ? hop.to.process : hop.to.role) : 'exit',
    description: hop.to ? `${units}: ${from} → ${to}` : `Receive ${units} from ${from} and take them off the line`,
    metadata: { ...hopFacets(input, hop, attempt, senderAttempt) } as Record<string, unknown>,
  };
}

export interface HopOutcome {
  received: boolean;
  errorCode?: HandoffErrorCode;
  detail?: string;
}

/** A timeout after some units arrived splits them between two stations, which a retry of the hop cannot move. */
function timedOut(items: { itemKey: string }[]): HopOutcome {
  const arrived = items.map((i) => arrivedUnit(i.itemKey)).filter((u): u is string => !!u);
  if (!arrived.length) return { received: false, errorCode: HANDOFF_ERROR.HANDOFF_TIMEOUT, detail: 'no receipt before the timeout' };
  return { received: false, errorCode: HANDOFF_ERROR.PARTIAL_ARRIVAL, detail: `${arrived.join(', ')} arrived; the rest did not before the timeout` };
}

/** Read a finished handoff row: a receipt, an error, a timeout, or a cancel. */
export function readHopOutcome(result: Record<string, any> | null): HopOutcome {
  if (result === null) return { received: false, errorCode: HANDOFF_ERROR.CANCELLED, detail: 'the handoff was cancelled' };
  if (result.$trigger === 'timeout') return timedOut(result.$accumulated ?? []);
  if (result.received === true) return { received: true };
  return { received: false, errorCode: result.errorCode, detail: result.detail ?? result.reason ?? undefined };
}
