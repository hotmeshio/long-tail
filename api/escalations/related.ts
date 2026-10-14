import * as escalationService from '../../services/escalation';
import * as roleService from '../../services/role';
import { isUuid } from '../../lib/uuid';
import {
  RELATED_LIMITS,
  RELATED_SOURCES,
  readListSchemaRelations,
  resolveRelatedFacets,
  rowTemplateContext,
  type ListSchemaRelations,
  type RelatedAggregatesResponse,
  type RelatedQueryDecl,
  type RelatedRowsResponse,
  type RelatedSetResult,
} from '../../shared/list-schema';
import { segmentRoles } from '../../shared/roles/segment';
import { getEscalationReadScope, type EscalationReadScope } from './helpers';
import type { LTApiAuth, LTApiResult } from '../../types/sdk';
import type { ReadScopeInput } from '../../services/escalation/read-scope-sql';

const DEFAULT_STATUS = 'pending';
const NOT_FOUND = 'Role list schema not found';

type Loaded =
  | { error: LTApiResult }
  | { scope: ReadScopeInput; readScope: EscalationReadScope; relations: ListSchemaRelations; version: number | null };

/** Gate the host role, then read its declaration from the stored list schema. */
async function loadDeclaration(role: unknown, version: unknown, auth: LTApiAuth): Promise<Loaded> {
  if (typeof role !== 'string' || !role) return { error: { status: 400, error: 'role is required' } };
  if (version !== undefined && (!Number.isInteger(version) || (version as number) < 1)) {
    return { error: { status: 400, error: 'version must be a positive integer' } };
  }
  const readScope = await getEscalationReadScope(auth.userId);
  const readable = readScope.global || readScope.allRoles.includes(role) || readScope.selfRoles.includes(role);
  if (!readable) return { error: { status: 404, error: NOT_FOUND } };
  const stored = await roleService.getRoleListSchema(role, version as number | undefined);
  if (!stored) return { error: { status: 404, error: NOT_FOUND } };
  let relations: ListSchemaRelations;
  try {
    relations = readListSchemaRelations(stored.list_schema);
  } catch (err: any) {
    return { error: { status: 422, error: `list schema for ${role}: ${err.message}` } };
  }
  const scope: ReadScopeInput = {
    global: readScope.global,
    visibleRoles: readScope.global ? undefined : readScope.allRoles,
    selfRoles: readScope.global ? undefined : readScope.selfRoles,
    meUserId: auth.userId,
  };
  return { scope, readScope, relations, version: stored.version };
}

interface ResolvedQuery {
  roles: string[];
  roleLabels: Record<string, string>;
  restricted: string[];
}

async function resolveQueryRoles(query: RelatedQueryDecl, readScope: EscalationReadScope): Promise<ResolvedQuery | string> {
  const details = await roleService.listRolesWithDetails();
  const roles = query.roles ?? segmentRoles(details, query.segment!);
  if (!roles) return `segment "${query.segment}" names no Pace Board sequence`;
  const titles = new Map(details.map((d: any) => [d.role, d.title]));
  const roleLabels: Record<string, string> = {};
  for (const r of roles) roleLabels[r] = (titles.get(r) as string | null) || r;
  const restricted = readScope.global ? [] : roles.filter((r) => !readScope.allRoles.includes(r));
  return { roles, roleLabels, restricted };
}

/** The split paths the declared columns ask of one set ('' when unsplit). */
function splitsFor(relations: ListSchemaRelations, set: string): string[] {
  const splits = new Set(relations.columns.filter((c) => c.related === set).map((c) => c.splitBy ?? ''));
  if (!splits.size) splits.add('');
  return [...splits];
}

/**
 * Aggregate every related set the role's list schema declares, for one page
 * of host rows. One statement per (set, split) pair, whatever the page size.
 */
export async function getRelatedAggregates(
  input: { role: string; ids: string[]; version?: number },
  auth: LTApiAuth,
): Promise<LTApiResult> {
  try {
    if (!Array.isArray(input.ids)) return { status: 400, error: 'ids must be an array of escalation ids' };
    if (input.ids.length > RELATED_LIMITS.MAX_HOSTS) {
      return { status: 400, error: `ids holds at most ${RELATED_LIMITS.MAX_HOSTS} rows` };
    }
    const loaded = await loadDeclaration(input.role, input.version, auth);
    if ('error' in loaded) return loaded.error;
    const { scope, readScope, relations, version } = loaded;
    const data: RelatedAggregatesResponse = { version, sets: {} };
    const names = Object.keys(relations.sets);
    const ids = [...new Set(input.ids.filter(isUuid))];
    if (!names.length || !ids.length) return { status: 200, data };

    const hosts = await escalationService.readRelatedHosts({ ids, role: input.role, scope });
    const hostIds = hosts.map((h) => h.id as string);

    for (const name of names) {
      const decl = relations.sets[name];
      const result: RelatedSetResult = { source: decl.source, aggregates: {} };
      if (decl.source === RELATED_SOURCES.ITEMS) {
        const roles = new Set<string>();
        for (const splitBy of splitsFor(relations, name)) {
          const read = await escalationService.aggregateRelatedItems({
            hostIds, scope, splitBy: splitBy || undefined,
          });
          result.aggregates[splitBy] = read.aggregates;
          read.roles.forEach((r) => roles.add(r));
        }
        if (roles.size) result.roles = [...roles].sort();
      } else {
        const resolved = await resolveQueryRoles(decl.query!, readScope);
        if (typeof resolved === 'string') return { status: 400, error: `x-lt-related.${name}: ${resolved}` };
        Object.assign(result, resolved);
        const matched: escalationService.RelatedQueryHost[] = [];
        const unresolved: string[] = [];
        for (const host of hosts) {
          const match = resolveRelatedFacets(decl.query!.facets ?? {}, rowTemplateContext(host), decl.query!.narrow);
          if (match) matched.push({ hostId: host.id as string, match });
          else unresolved.push(host.id as string);
        }
        for (const splitBy of splitsFor(relations, name)) {
          const agg = await escalationService.aggregateRelatedQuery({
            hosts: matched, roles: resolved.roles, status: decl.query!.status ?? DEFAULT_STATUS, scope,
            splitBy: splitBy || undefined,
          });
          for (const id of unresolved) agg[id] = { count: 0, unresolved: true };
          result.aggregates[splitBy] = agg;
        }
      }
      data.sets[name] = result;
    }
    return { status: 200, data };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}

/** One host's rows in one related set, for a row detail section. */
export async function getRelatedRows(
  input: { role: string; id: string; set: string; version?: number; limit?: number },
  auth: LTApiAuth,
): Promise<LTApiResult> {
  try {
    if (!isUuid(input.id)) return { status: 400, error: 'id must be an escalation id' };
    if (input.limit !== undefined && (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > RELATED_LIMITS.ROWS_MAX)) {
      return { status: 400, error: `limit must be 1..${RELATED_LIMITS.ROWS_MAX}` };
    }
    const loaded = await loadDeclaration(input.role, input.version, auth);
    if ('error' in loaded) return loaded.error;
    const { scope, readScope, relations } = loaded;
    const decl = relations.sets[input.set];
    if (!decl) return { status: 404, error: `x-lt-related declares no set "${input.set}"` };
    const [host] = await escalationService.readRelatedHosts({ ids: [input.id], role: input.role, scope });
    if (!host) return { status: 404, error: 'Escalation not found' };
    const limit = input.limit ?? RELATED_LIMITS.ROWS_DEFAULT;

    if (decl.source === RELATED_SOURCES.ITEMS) {
      const { rows, total } = await escalationService.listRelatedItems({ hostId: input.id, scope, limit });
      const data: RelatedRowsResponse = { source: decl.source, rows, total };
      return { status: 200, data };
    }
    const resolved = await resolveQueryRoles(decl.query!, readScope);
    if (typeof resolved === 'string') return { status: 400, error: `x-lt-related.${input.set}: ${resolved}` };
    const match = resolveRelatedFacets(decl.query!.facets ?? {}, rowTemplateContext(host), decl.query!.narrow);
    const { rows, total } = match
      ? await escalationService.listRelatedQueryRows({
          hosts: [{ hostId: input.id, match }], roles: resolved.roles,
          status: decl.query!.status ?? DEFAULT_STATUS, scope, limit,
        })
      : { rows: [], total: 0 };
    const data: RelatedRowsResponse = {
      source: decl.source, rows, total, restricted: resolved.restricted, roleLabels: resolved.roleLabels,
    };
    return { status: 200, data };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}
