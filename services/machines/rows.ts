/**
 * Which escalation rows are machine handoffs, and what each one asks for.
 * The workflow parks an ordinary row; this adapter reads it into the task
 * the gateway dispatches. The standard adapter reads the handoff facets
 * (contracts.ts); a host whose rows carry its own facets supplies its own,
 * so neither the workflow nor its rows change to be resolved by a machine.
 */

import type { LineDef } from '../../lib/machines/line';
import { ROW_TYPE, type ArtifactRef, type HandoffFacets, type HandoffUnit } from './contracts';

/** The parts of an escalation row the adapter reads. */
export interface EscalationRowView {
  id: string;
  role: string;
  type?: string;
  subtype?: string;
  metadata?: Record<string, any>;
}

/** Open rows to read when the gateway starts leading a line. */
export interface OpenRowQuery {
  type?: string;
  role?: string;
}

export interface HandoffRowAdapter {
  openRows(line: LineDef): OpenRowQuery[];
  /** The handoff a row asks for, or null when it is not a machine handoff. */
  toHandoff(row: EscalationRowView): HandoffFacets | null;
}

const str = (v: unknown): string | null => (v === undefined || v === null || v === '' ? null : String(v));

/** A plain object of parameters; anything else is not parameters. */
function paramsOf(v: unknown): Record<string, unknown> | undefined {
  return v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : undefined;
}

function artifactOf(v: any): ArtifactRef | undefined {
  if (!v || typeof v.url !== 'string' || !v.url || typeof v.sha256 !== 'string' || !v.sha256) return undefined;
  return {
    url: v.url, sha256: v.sha256,
    ...(typeof v.id === 'string' && v.id ? { id: v.id } : {}),
    ...(typeof v.contentType === 'string' && v.contentType ? { contentType: v.contentType } : {}),
    ...(Number.isInteger(v.sizeBytes) && v.sizeBytes >= 0 ? { sizeBytes: v.sizeBytes } : {}),
  };
}

function artifactsOf(v: unknown): ArtifactRef[] | undefined {
  const list = Array.isArray(v) ? v.map(artifactOf).filter((a): a is ArtifactRef => !!a) : [];
  return list.length ? list : undefined;
}

function unitsOf(v: unknown): HandoffUnit[] {
  if (!Array.isArray(v)) return [];
  return v.filter((u) => u && u.unitId).map((u) => {
    const artifact = artifactOf(u.artifact);
    const artifacts = artifactsOf(u.artifacts);
    const parameters = paramsOf(u.parameters);
    return {
      unitId: String(u.unitId), carrierId: str(u.carrierId),
      ...(artifact ? { artifact } : {}), ...(artifacts ? { artifacts } : {}), ...(parameters ? { parameters } : {}),
    };
  });
}

/** Read standard handoff facets; null when the line, job or units are missing. */
export function readHandoffFacets(md: Record<string, any> = {}): HandoffFacets | null {
  const units = unitsOf(md.units);
  if (!md.siteId || !md.lineId || !md.jobId || !units.length) return null;
  return {
    siteId: String(md.siteId),
    lineId: String(md.lineId),
    units,
    jobId: String(md.jobId),
    senderJobId: str(md.senderJobId),
    orderRef: String(md.orderRef ?? ''),
    fromMachine: str(md.fromMachine),
    toMachine: str(md.toMachine),
    recipeId: str(md.recipeId),
    recipeVersion: str(md.recipeVersion),
    process: str(md.process),
    artifactUrl: str(md.artifactUrl),
    artifactSha256: str(md.artifactSha256),
    attempt: Number(md.attempt ?? 1),
    ...(paramsOf(md.parameters) ? { parameters: paramsOf(md.parameters) } : {}),
  };
}

export const standardRows: HandoffRowAdapter = {
  openRows: () => [{ type: ROW_TYPE.HANDOFF }],
  toHandoff: (row) => (row.type === ROW_TYPE.HANDOFF ? readHandoffFacets(row.metadata) : null),
};
