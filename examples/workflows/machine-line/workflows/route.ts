/**
 * The pure part of the unit workflow: the hops a set of units takes along the
 * route, the row each hop parks, and what a finished row means.
 */

import { HANDOFF_ERROR, LINE_ROLE, ROW_TYPE, type HandoffErrorCode, type HandoffFacets, type HandoffUnit } from '../../../../services/machines/contracts';
import { stationRole, type LineDef } from '../../../../lib/machines/line';

export const UNIT_ROUTE_WORKFLOW = 'machineUnitRoute';

export interface RouteStep {
  machineId: string;
  process: string;
  recipe: { id: string; version: string };
}

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
}

/** Every machine on the line in order, each on its first recipe at the newest version. */
export function lineSteps(line: LineDef): RouteStep[] {
  return line.machines.map((m) => {
    const [id, versions] = Object.entries(m.recipes)[0];
    return { machineId: m.machineId, process: m.process, recipe: { id, version: versions[versions.length - 1] } };
  });
}

/** One move: from a machine (null at line entry) to a machine (null at line exit, where a person receives). */
export interface Hop {
  index: number;
  from: RouteStep | null;
  to: RouteStep | null;
}

export function planHops(steps: RouteStep[]): Hop[] {
  const stops: (RouteStep | null)[] = [null, ...steps, null];
  return stops.slice(1).map((to, i) => ({ index: i, from: stops[i], to }));
}

export const jobIdFor = (routeKey: string, step: RouteStep | null) => `${routeKey}-${step?.machineId ?? 'exit'}`;

export function hopFacets(input: UnitRouteInput, hop: Hop, attempt: number): HandoffFacets {
  return {
    siteId: input.siteId,
    lineId: input.lineId,
    units: input.units,
    jobId: jobIdFor(input.routeKey, hop.to),
    senderJobId: hop.from ? jobIdFor(input.routeKey, hop.from) : null,
    orderRef: input.orderRef,
    fromMachine: hop.from?.machineId ?? null,
    toMachine: hop.to?.machineId ?? null,
    recipeId: hop.to?.recipe.id ?? null,
    recipeVersion: hop.to?.recipe.version ?? null,
    process: hop.to?.process ?? null,
    artifactUrl: hop.to && input.artifact ? input.artifact.url : null,
    artifactSha256: hop.to && input.artifact ? input.artifact.sha256 : null,
    attempt,
  };
}

/** The row a hop parks: the receiver's role, or the exit role when a person receives. */
export function hopRow(input: UnitRouteInput, hop: Hop, attempt: number) {
  const from = hop.from?.machineId ?? 'line entry';
  const to = hop.to?.machineId ?? 'line exit';
  const units = input.units.map((u) => u.unitId).join(', ');
  return {
    role: hop.to ? stationRole(hop.to.process) : LINE_ROLE.EXIT,
    type: ROW_TYPE.HANDOFF,
    subtype: hop.to ? hop.to.process : 'exit',
    description: hop.to ? `${units}: ${from} → ${to}` : `Receive ${units} from ${from} and take them off the line`,
    metadata: { ...hopFacets(input, hop, attempt) } as Record<string, unknown>,
  };
}

export interface HopOutcome {
  received: boolean;
  errorCode?: HandoffErrorCode;
  detail?: string;
}

/** Read a finished handoff row: a receipt, an error, a timeout, or a cancel. */
export function readHopOutcome(result: Record<string, any> | null): HopOutcome {
  if (result === null) return { received: false, errorCode: HANDOFF_ERROR.CANCELLED, detail: 'the handoff was cancelled' };
  if (result.$trigger === 'timeout') return { received: false, errorCode: HANDOFF_ERROR.HANDOFF_TIMEOUT, detail: 'no receipt before the timeout' };
  if (result.received === true) return { received: true };
  return { received: false, errorCode: result.errorCode, detail: result.detail ?? result.reason ?? undefined };
}
