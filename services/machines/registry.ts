/**
 * The line registry: every line this deployment controls, in Postgres, so
 * every replica contends for the same lines and the Lines index reads one
 * list. Lines come from code (start({ machines })) and from the API; the
 * configSource rules decide who wins at boot, the version says what changed.
 */

import { isDeepStrictEqual } from 'node:util';

import { getPool } from '../../lib/db';
import { loggerRegistry } from '../../lib/logger';
import { machineRole, validateLine, type LineDef } from '../../lib/machines/line';
import type { LineHealth, LineSource, SiteSummary } from '../../types/machines-view';
import {
  APPLY_CODE_LINE, DELETE_LINE, GET_LINE, HEALTH_ROW_TYPES, LINE_ORDER, LINE_SOURCE,
  LIST_CODE_LINES, LIST_ENABLED_LINES, LIST_SITES, SEED_CODE_LINE, UPSERT_API_LINE, listLinesSql,
} from './registry-sql';

export { LINE_SOURCE };

/** A registry row. */
export interface LineRecord {
  siteId: string;
  lineId: string;
  definition: LineDef;
  source: LineSource;
  version: number;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

/** A registry row with its pending rows counted. */
export interface LineRecordWithHealth extends LineRecord {
  health: LineHealth;
}

export interface LineListQuery {
  q?: string;
  site?: string;
  /** One line by id, with `site`. */
  line?: string;
  attention?: boolean;
  sort?: keyof typeof LINE_ORDER;
  limit?: number;
  offset?: number;
}

export interface LineListPage {
  lines: LineRecordWithHealth[];
  total: number;
  limit: number;
  offset: number;
}

/** What boot did with each code line, and the code lines it no longer declares. */
export interface LineApplyReport {
  applied: string[];
  unchanged: string[];
  dbOwned: string[];
  orphans: string[];
}

/** A write that named a version the row no longer has. */
export class LineVersionConflict extends Error {
  constructor(readonly siteId: string, readonly lineId: string, readonly expected: number) {
    super(`line ${siteId}/${lineId} is not at version ${expected}`);
    this.name = 'LineVersionConflict';
  }
}

export const DEFAULT_LINE_PAGE = 50;
export const MAX_LINE_PAGE = 200;

const LOG = '[lt-machines]';

/** The index's search text: everything a person might type to find the line. */
export function searchTextOf(line: LineDef): string {
  const words = [line.siteId, line.lineId];
  for (const m of line.machines) words.push(m.machineId, m.process, machineRole(m), m.address ?? '');
  return [...new Set(words.filter(Boolean).map((w) => w.toLowerCase()))].join(' ');
}

function toRecord(row: any): LineRecord {
  return {
    siteId: row.site_id, lineId: row.line_id, definition: row.definition, source: row.source,
    version: row.version, enabled: row.enabled,
    createdAt: new Date(row.created_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString(),
  };
}

function toHealth(row: any): LineHealth {
  const machines = Array.isArray(row.definition?.machines) ? row.definition.machines.length : 0;
  return {
    machines, offline: row.offline, quiet: row.quiet, alarms: row.alarms, people: row.people,
    handoff: row.handoff, command: row.command, attention: row.attention === true,
  };
}

function keyOf(siteId: string, lineId: string): string {
  return `${siteId}/${lineId}`;
}

/** A LIKE pattern that matches the text anywhere, with the person's wildcards taken literally. */
function likePattern(q: string): string {
  return `%${q.trim().toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/** Declare a line through the API: insert, or replace and advance its version. */
export async function declareApiLine(def: LineDef, expectedVersion?: number): Promise<LineRecord> {
  const line = validateLine(def);
  const { rows } = await getPool().query(UPSERT_API_LINE, [
    line.siteId, line.lineId, JSON.stringify(line), searchTextOf(line), expectedVersion ?? null,
  ]);
  if (!rows.length) throw new LineVersionConflict(line.siteId, line.lineId, expectedVersion!);
  return toRecord(rows[0]);
}

/**
 * Apply one code line. Db-owned: insert if absent, otherwise leave the row
 * and log drift. Code-owned: write when the definition differs, once.
 */
export async function applyCodeLine(def: LineDef, codeOwned: boolean): Promise<'applied' | 'unchanged' | 'db-owned'> {
  const line = validateLine(def);
  const params = [line.siteId, line.lineId, JSON.stringify(line), searchTextOf(line)];
  const { rows } = await getPool().query(codeOwned ? APPLY_CODE_LINE : SEED_CODE_LINE, params);
  if (rows.length) return 'applied';
  if (codeOwned) return 'unchanged';
  const existing = await getLine(line.siteId, line.lineId);
  if (existing && !isDeepStrictEqual(existing.definition, line)) {
    loggerRegistry.warn(`${LOG} line ${keyOf(line.siteId, line.lineId)} differs from its declaration; the registry row stands (db-owned)`);
  }
  return 'db-owned';
}

/** Boot: apply every code line and report, naming code lines the registry still holds that code no longer declares. */
export async function applyDeclaredLines(lines: LineDef[], codeOwned: boolean): Promise<LineApplyReport> {
  const report: LineApplyReport = { applied: [], unchanged: [], dbOwned: [], orphans: [] };
  const declared = new Set<string>();
  for (const line of lines) {
    const key = keyOf(line.siteId, line.lineId);
    declared.add(key);
    const outcome = await applyCodeLine(line, codeOwned);
    if (outcome === 'applied') report.applied.push(key);
    else if (outcome === 'unchanged') report.unchanged.push(key);
    else report.dbOwned.push(key);
  }
  const { rows } = await getPool().query(LIST_CODE_LINES);
  report.orphans = rows.map((r: any) => keyOf(r.site_id, r.line_id)).filter((k: string) => !declared.has(k));
  const counts = `applied ${report.applied.length}, unchanged ${report.unchanged.length}, db-owned ${report.dbOwned.length}`;
  if (report.orphans.length) loggerRegistry.warn(`${LOG} lines: ${counts}, declared in code before and not now: [${report.orphans.join(', ')}]`);
  else loggerRegistry.info(`${LOG} lines: ${counts}`);
  return report;
}

export async function getLine(siteId: string, lineId: string): Promise<LineRecord | null> {
  const { rows } = await getPool().query(GET_LINE, [siteId, lineId]);
  return rows.length ? toRecord(rows[0]) : null;
}

export async function deleteLine(siteId: string, lineId: string): Promise<LineRecord | null> {
  const { rows } = await getPool().query(DELETE_LINE, [siteId, lineId]);
  return rows.length ? toRecord(rows[0]) : null;
}

/** Every enabled line, code and API alike: what a replica contends for. */
export async function listEnabledLines(): Promise<LineRecord[]> {
  const { rows } = await getPool().query(LIST_ENABLED_LINES);
  return rows.map(toRecord);
}

/** One page of the index, searched and filtered in SQL, with each line's pending rows counted. */
export async function listLines(query: LineListQuery = {}): Promise<LineListPage> {
  const limit = Math.min(Math.max(1, Math.floor(query.limit ?? DEFAULT_LINE_PAGE)), MAX_LINE_PAGE);
  const offset = Math.max(0, Math.floor(query.offset ?? 0));
  const order = LINE_ORDER[query.sort ?? 'attention'];
  if (!order) throw new Error(`sort must be one of ${Object.keys(LINE_ORDER).join(', ')}`);
  const { rows } = await getPool().query(listLinesSql(order), [
    [...HEALTH_ROW_TYPES], query.q?.trim() ? likePattern(query.q) : null, query.site || null,
    query.attention ?? null, limit, offset, query.line || null,
  ]);
  return {
    lines: rows.map((r: any) => ({ ...toRecord(r), health: toHealth(r) })),
    total: rows.length ? Number(rows[0].total) : 0,
    limit, offset,
  };
}

/** One line with its pending rows counted, or null. */
export async function getLineWithHealth(siteId: string, lineId: string): Promise<LineRecordWithHealth | null> {
  const page = await listLines({ site: siteId, line: lineId, limit: 1 });
  return page.lines[0] ?? null;
}

export async function listSites(): Promise<SiteSummary[]> {
  const { rows } = await getPool().query(LIST_SITES, [[...HEALTH_ROW_TYPES]]);
  return rows.map((r: any) => ({ siteId: r.site_id, lines: r.lines, attention: r.attention }));
}
