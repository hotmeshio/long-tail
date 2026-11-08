/**
 * The pure part of the unit workflow: the hops a set of units takes along the
 * route, the row each hop parks, and what a finished row means.
 */

import { HANDOFF_ERROR, LINE_ROLE, ROW_TYPE, handoffProgress, type HandoffErrorCode, type HandoffFacets, type HandoffUnit } from '../../../../services/machines/contracts';
import { machineById, machineRole, stationRole, type LineDef } from '../../../../lib/machines/line';

export const UNIT_ROUTE_WORKFLOW = 'machineUnitRoute';

/** A station a machine works: the gateway dispatches to it and resolves the handoff as it. */
export interface MachineStep {
  machineId: string;
  process: string;
  recipe: { id: string; version: string };
  /** The machine's role when the line names one; line-<process> otherwise. */
  role?: string;
  /** Parameters this station's job needs, sent to the machine as given. */
  parameters?: Record<string, unknown>;
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
  /** The role of the person who decides a failed handoff: retry, manual or scrap; line-operator by default. */
  operatorRole?: string;
  /** The role of the people who decide units a machine finished on hold; line-quality by default. */
  qualityRole?: string;
  /** The command the line's codec declares for a hold decision (`rowOps`); the decision is sent to the holding machine as that command. */
  dispositionOp?: string;
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
export function hopFacets(input: UnitRouteInput, hop: Hop, attempt: number, senderAttempt = 1, units = input.units): HandoffFacets {
  return {
    siteId: input.siteId,
    lineId: input.lineId,
    units,
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
    ...(machineOf(hop.to)?.parameters ? { parameters: machineOf(hop.to)!.parameters } : {}),
  };
}

export function roleOf(input: UnitRouteInput, step: RouteStep | null): string {
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

/**
 * A row asking a person to collect units where they stopped, outside any
 * handoff between stations: it names no sender, so no machine event touches it.
 */
export function pickupRow(input: UnitRouteInput, index: number, at: RouteStep, units: HandoffUnit[]) {
  const hop: Hop = { index, from: null, to: null };
  const names = units.map((u) => u.unitId).join(', ');
  return {
    role: roleOf(input, null),
    type: ROW_TYPE.HANDOFF,
    subtype: 'pickup',
    description: `Collect ${names} at ${stationKey(at)} and take them off the line`,
    metadata: { ...hopFacets(input, hop, 1, 1, units), jobId: `${input.routeKey}-pickup-${stationKey(at)}`, pickupAt: stationKey(at) } as Record<string, unknown>,
  };
}

/** How a hop ended; on a failure, which units reached the receiver and which did not. */
export interface HopOutcome {
  received: boolean;
  errorCode?: HandoffErrorCode;
  detail?: string;
  /** On `sender-rejected`: how the sender finished the units (reject, hold, scrap, rework). */
  result?: string;
  arrived?: string[];
  missing?: string[];
}

/** Read a finished handoff row for `units`: a receipt, an error, a timeout, or a cancel. */
export function readHopOutcome(result: Record<string, any> | null, units: readonly string[]): HopOutcome {
  if (result === null) return { received: false, errorCode: HANDOFF_ERROR.CANCELLED, detail: 'the handoff was cancelled' };
  if (result.received === true) return { received: true };
  const { arrived, missing } = handoffProgress(units, result.$accumulated ?? []);
  if (result.$trigger !== 'timeout') {
    const held = typeof result.result === 'string' ? { result: result.result } : {};
    return { received: false, errorCode: result.errorCode, detail: result.detail ?? result.reason ?? undefined, ...held, arrived, missing };
  }
  // A timeout after some units arrived has split them between two stations.
  return arrived.length
    ? { received: false, errorCode: HANDOFF_ERROR.PARTIAL_ARRIVAL, detail: `${arrived.join(', ')} arrived; the rest did not before the timeout`, arrived, missing }
    : { received: false, errorCode: HANDOFF_ERROR.HANDOFF_TIMEOUT, detail: 'no receipt before the timeout', arrived, missing };
}

/** The hop to run again for a rework from `station`: the hop into it, or the hop that is holding when it names none on the route. */
export function reworkHop(hops: Hop[], holding: Hop, station?: string): Hop {
  if (!station) return holding;
  const into = hops.find((h) => h.index <= holding.index && isMachineStep(h.to) && h.to.machineId === station);
  return into ?? holding;
}

