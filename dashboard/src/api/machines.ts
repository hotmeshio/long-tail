import { useQuery } from '@tanstack/react-query';
import { apiFetch, ApiError } from './client';
import { NATS_SUBJECT_PREFIX } from '../lib/nats/config';
import { sanitizeSubjectToken } from '../lib/events/subjects';

// ── Wire types ───────────────────────────────────────────────────────────────

export type MachineAddressing = 'declared' | 'learned';

export interface LineSummaryMachine {
  machineId: string;
  process: string;
  role: string;
  address: string | null;
  addressing: MachineAddressing;
  /** Command ops the line's codec declares beyond the generic control set. */
  rowOps?: readonly string[];
}

export interface LineSummary {
  siteId: string;
  lineId: string;
  machines: LineSummaryMachine[];
}

export interface HeldUnit {
  unitId: string;
  carrierId: string | null;
  rowId: string;
}

export interface MachineRows {
  handoff: number;
  command: number;
  alarm: number;
  offlineRowId: string | null;
  quietRowId: string | null;
}

export interface MachineAlarm {
  alarmId: string;
  level: string;
  raisedAt: string;
  rowId: string | null;
}

export interface MachineView {
  machineId: string;
  process: string;
  role: string;
  address: string | null;
  online: boolean | null;
  since: string | null;
  lastSeen: string | null;
  software: string | null;
  bootId: string | null;
  sessionId: string | null;
  heldUnits: HeldUnit[];
  rows: MachineRows;
  alarms: MachineAlarm[];
  /** The last snapshot's jobs, as the codec reported them. */
  jobs: unknown[];
}

export interface ContestedAddress {
  address: string;
  station: string;
  rowId: string;
}

export interface LineView {
  siteId: string;
  lineId: string;
  leading: boolean;
  takenAt: string | null;
  machines: MachineView[];
  contested: ContestedAddress[];
  /** The line as every replica describes it, leading or standing by. */
  summary?: LineSummary;
}

export type WireDirection = 'in' | 'out';

export const WIRE_KINDS = [
  'presence', 'snapshot', 'job', 'alarm', 'telemetry', 'report', 'cmd', 'reply', 'receipt', 'unknown',
] as const;
export type WireKind = (typeof WIRE_KINDS)[number];

export const WIRE_VERBS = [
  'claim', 'accumulate', 'resolve', 'create-row', 'refuse', 'hold', 'unmatched', 'unreadable', 'ack', 'none',
] as const;
export type WireVerb = (typeof WIRE_VERBS)[number];

export interface WireAction {
  verb: WireVerb;
  rowId?: string;
  itemKey?: string;
  detail?: string;
}

export const WIRE_EVENT_TYPE = 'machine.wire';

export interface WireEvent {
  type: typeof WIRE_EVENT_TYPE;
  siteId: string;
  lineId: string;
  machineId: string | null;
  address: string | null;
  direction: WireDirection;
  channel: string;
  topic: string;
  id: string | null;
  at: string;
  retained: boolean;
  kind: WireKind;
  /** Job event name, alarm action, command op, reply status. */
  event: string | null;
  /** One line, built from kind, event and unit or job ids. */
  summary: string;
  violations: string[];
  actions: WireAction[];
  /** Builders only; stripped for everyone else. */
  payload?: unknown;
}

export interface InspectRequest {
  topic: string;
  payload: unknown;
  retained?: boolean;
}

export interface InspectResult {
  kind?: WireKind | null;
  event?: string | null;
  summary?: string | null;
  inspections?: unknown;
  violations: string[];
  actions: WireAction[];
}

export interface CommandRequest {
  op: string;
  args?: Record<string, unknown>;
}

export interface CommandReceipt {
  rowId: string;
}

// ── Command vocabulary ───────────────────────────────────────────────────────

export const CONTROL_OPS = ['start', 'stop', 'pause', 'resume', 'changeover', 'cancel'] as const;
export type ControlOp = (typeof CONTROL_OPS)[number];
export const SNAPSHOT_OP = 'snapshot';

/** The ops a machine's command select offers: control, snapshot, then the codec's declared ops. */
export function commandOpsFor(machine: Pick<LineSummaryMachine, 'rowOps'> | null | undefined): string[] {
  const declared = machine?.rowOps ?? [];
  return [...new Set<string>([...CONTROL_OPS, SNAPSHOT_OP, ...declared])];
}

/** Facets an escalation row carries for the machine it addresses. */
export const MACHINE_FACETS = { TO: 'toMachine', FROM: 'fromMachine' } as const;

// ── Subjects and keys ────────────────────────────────────────────────────────

export const MACHINE_LINES_QUERY_KEY = 'machineLines';
export const MACHINE_LINE_QUERY_KEY = 'machineLine';

export function machineLineQueryKey(siteId: string, lineId: string): [string, string, string] {
  return [MACHINE_LINE_QUERY_KEY, siteId, lineId];
}

/** Every wire event of one line, both directions: `lt.events.machine.wire.<site>.<line>.>`. */
export function machineWirePattern(siteId: string, lineId: string): string {
  return `${NATS_SUBJECT_PREFIX}.${WIRE_EVENT_TYPE}.${sanitizeSubjectToken(siteId)}.${sanitizeSubjectToken(lineId)}.>`;
}

// ── Index ────────────────────────────────────────────────────────────────────

export type LineSource = 'code' | 'api';

/** Pending rows on the line, counted by what they ask of whom. */
export interface LineHealth {
  machines: number;
  offline: number;
  quiet: number;
  alarms: number;
  /** Rows waiting on a person: failed handoffs, contract violations, registrations. */
  people: number;
  handoff: number;
  command: number;
  attention: boolean;
}

export interface LineIndexRow extends LineSummary {
  source: LineSource;
  version: number;
  enabled: boolean;
  updatedAt: string;
  /** This replica leads the line now. */
  leading: boolean;
  health: LineHealth;
}

export interface SiteSummary {
  siteId: string;
  lines: number;
  attention: number;
}

export interface LineIndex {
  lines: LineIndexRow[];
  total: number;
  sites: SiteSummary[];
  limit: number;
  offset: number;
  /** False when the deployment has no machine surface at all. */
  declared: boolean;
}

export const LINE_SORTS = ['attention', 'site', 'updated'] as const;
export type LineSort = (typeof LINE_SORTS)[number];

export interface LineIndexParams {
  q?: string;
  site?: string;
  attention?: boolean;
  sort?: LineSort;
  limit: number;
  offset: number;
}

/** A line as declared to the registry; the server validates the rest of the shape. */
export interface LineDefinition {
  siteId: string;
  lineId: string;
  machines: Array<{ machineId: string; process: string } & Record<string, unknown>>;
  [key: string]: unknown;
}

export interface DeclareLineRequest {
  definition: LineDefinition;
  version?: number;
}

export const MACHINE_LINE_INDEX_QUERY_KEY = 'machineLineIndex';
export const MACHINE_LINE_EVENT_TYPE = 'machine.line';
export const MACHINE_LOG_EVENT_TYPE = 'machine.log';

/** Every line declared or retired, on every replica: `lt.events.machine.line.>`. */
export function machineLinePattern(): string {
  return `${NATS_SUBJECT_PREFIX}.${MACHINE_LINE_EVENT_TYPE}.>`;
}

/** Every gateway log entry of every line: `lt.events.machine.log.>`. */
export function machineLogPattern(): string {
  return `${NATS_SUBJECT_PREFIX}.${MACHINE_LOG_EVENT_TYPE}.>`;
}

// ── Reads ────────────────────────────────────────────────────────────────────

const LINES_PATH = '/machines/lines';

function linePath(siteId: string, lineId: string): string {
  return `${LINES_PATH}/${encodeURIComponent(siteId)}/${encodeURIComponent(lineId)}`;
}

/** A deployment without declared lines answers 404; that reads as no lines. */
export async function fetchLines(): Promise<LineSummary[]> {
  try {
    const data = await apiFetch<{ lines: LineSummary[] } | LineSummary[]>(LINES_PATH);
    return Array.isArray(data) ? data : data.lines ?? [];
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return [];
    throw err;
  }
}

export function useLines() {
  return useQuery<LineSummary[]>({
    queryKey: [MACHINE_LINES_QUERY_KEY],
    queryFn: fetchLines,
    staleTime: 60_000,
  });
}

/** A replica that is standing by answers `{ leading: false }`; the view fills in an empty line. */
export async function fetchLine(siteId: string, lineId: string): Promise<LineView> {
  const data = await apiFetch<Partial<LineView>>(linePath(siteId, lineId));
  return {
    siteId: data.siteId ?? siteId,
    lineId: data.lineId ?? lineId,
    leading: data.leading === true,
    takenAt: data.takenAt ?? null,
    machines: data.machines ?? [],
    contested: data.contested ?? [],
    ...(data.summary ? { summary: data.summary } : {}),
  };
}

export function useLine(siteId: string | undefined, lineId: string | undefined) {
  return useQuery<LineView>({
    queryKey: machineLineQueryKey(siteId ?? '', lineId ?? ''),
    queryFn: () => fetchLine(siteId!, lineId!),
    enabled: !!siteId && !!lineId,
    staleTime: 5_000,
  });
}

function emptyIndex(params: LineIndexParams, declared: boolean): LineIndex {
  return { lines: [], total: 0, sites: [], limit: params.limit, offset: params.offset, declared };
}

/** The paginated, searchable index; a deployment without a surface answers 404 and reads as undeclared. */
export async function fetchLineIndex(params: LineIndexParams): Promise<LineIndex> {
  const query = new URLSearchParams();
  if (params.q) query.set('q', params.q);
  if (params.site) query.set('site', params.site);
  if (params.attention) query.set('attention', 'true');
  if (params.sort) query.set('sort', params.sort);
  query.set('limit', String(params.limit));
  query.set('offset', String(params.offset));
  try {
    const data = await apiFetch<Partial<LineIndex>>(`${LINES_PATH}?${query.toString()}`);
    return {
      lines: data.lines ?? [],
      total: data.total ?? data.lines?.length ?? 0,
      sites: data.sites ?? [],
      limit: data.limit ?? params.limit,
      offset: data.offset ?? params.offset,
      declared: true,
    };
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return emptyIndex(params, false);
    throw err;
  }
}

export function lineIndexQueryKey(params: LineIndexParams): [string, LineIndexParams] {
  return [MACHINE_LINE_INDEX_QUERY_KEY, params];
}

export function useLineIndex(params: LineIndexParams) {
  return useQuery<LineIndex>({
    queryKey: lineIndexQueryKey(params),
    queryFn: () => fetchLineIndex(params),
    staleTime: 5_000,
    placeholderData: (previous) => previous,
  });
}

/** Declare a line, or replace a declared one; `version` guards against a concurrent edit. */
export function declareLine(siteId: string, lineId: string, body: DeclareLineRequest): Promise<{ line: LineIndexRow }> {
  return apiFetch<{ line: LineIndexRow }>(linePath(siteId, lineId), { method: 'PUT', body: JSON.stringify(body) });
}

/** Retire a line: its gateway stops on every replica; rows and roles stay. The reply carries no body. */
export async function retireLine(siteId: string, lineId: string): Promise<void> {
  try {
    await apiFetch<unknown>(linePath(siteId, lineId), { method: 'DELETE' });
  } catch (err) {
    if (err instanceof SyntaxError) return;
    throw err;
  }
}

// ── Tools ────────────────────────────────────────────────────────────────────

/** Dry run: decode and plan one message without applying it. Leader only. */
export function inspectMessage(siteId: string, lineId: string, body: InspectRequest): Promise<InspectResult> {
  return apiFetch<InspectResult>(`${linePath(siteId, lineId)}/inspect`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/** Create a command row for one machine; the machine's role decides access. */
export function sendCommand(
  siteId: string,
  lineId: string,
  machineId: string,
  body: CommandRequest,
): Promise<CommandReceipt> {
  return apiFetch<CommandReceipt>(
    `${linePath(siteId, lineId)}/machines/${encodeURIComponent(machineId)}/commands`,
    { method: 'POST', body: JSON.stringify({ op: body.op, args: body.args ?? {} }) },
  );
}
