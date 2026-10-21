import * as escalationService from '../../services/escalation';
import * as userService from '../../services/user';
import { loadRoster } from '../../services/escalation/roster';
import { consumeActingGrant, peekActingAuth, refundActingGrant } from '../../services/iam/acting-identity';
import {
  ENTERED_CODE_KEY,
  ROSTER_ACTION_KINDS,
  actionRefusal,
  enteredCodeMatches,
  holdsActionRole,
  interpolatePayload,
  printedKeyCode,
  readRosterActions,
  readRosterDef,
  rosterActionKind,
  rosterRowContext,
  type RosterActionDef,
  type RosterEntry,
  type ShowIfContext,
} from '../../shared/form-validation';
import type { LTApiAuth, LTApiResult } from '../../types/sdk';

import { flagBatchItem, unflagBatchItem } from './batch-flag';
import { assertReadAccess } from './helpers';
import { resolveEscalation } from './resolve';
import { resolveBatchItem } from './resolve-batch';

/** Outcomes a roster action answers with besides the act's own result. */
export const ROSTER_ACTION_OUTCOMES = {
  /** The action is limited to roles the person acting does not hold, and no badge rode the request. */
  NEEDS_BADGE: 'needs_badge',
  /** A badge rode the request, and its person does not hold the action's roles. */
  ROLE_REFUSED: 'role_refused',
  /** The badge expired or was spent; scan it again. */
  NOT_PRIMED: 'not_primed',
} as const;

export interface RosterActionInput {
  /** The host row: the escalation whose form declares the roster. */
  id: string;
  /** The roster field. */
  field: string;
  /** The action's index among the field's actions. */
  action: number;
  /** The entry's key. */
  entry: string;
  /** A key-in's entered code. */
  code?: string;
  /** A badge grant: the act runs as its person. */
  actingToken?: string;
}

/** The roster's context on the server: the host row's own domains. */
function hostContext(row: Record<string, unknown>): ShowIfContext {
  const { escalation, metadata, envelope, payload } = rosterRowContext(row);
  return { escalation, metadata, envelope, payload };
}

/**
 * Run one action a roster entry offers. The request is a pointer (field,
 * action index, entry key) and never authority: the action is re-read from
 * the host row's pinned form schema, the entry must be on the roster the
 * server computes, the payload is built here from the declaration, and a
 * role limit is checked against the person acting. The act then runs
 * through the endpoint it names (resolve, batch fill, flag, unflag) under
 * that person's own RBAC and `enforce_schema`.
 *
 * A badge is read first and spent only once the act is about to run; an
 * act that does not land returns the use.
 */
export async function runRosterAction(input: RosterActionInput, auth: LTApiAuth): Promise<LTApiResult> {
  try {
    if (!input?.id || typeof input.field !== 'string' || !Number.isInteger(input.action)
      || typeof input.entry !== 'string' || !input.entry) {
      return { status: 400, error: 'id, field, action and entry are required' };
    }

    // 1. The host row and its form, as the page that offered the action read them
    const detail = await escalationService.getEscalationWithFormSchema(input.id);
    if (!detail || (await assertReadAccess(auth.userId, detail.escalation))) {
      return { status: 404, error: 'Escalation not found' };
    }
    const host = detail.escalation;
    const embedded = (host.metadata as Record<string, any> | null)?.form_schema;
    const schema = (embedded && typeof embedded === 'object' ? embedded : detail.form_schema) as Record<string, any> | null;
    const fieldSchema = schema?.properties?.[input.field] as Record<string, unknown> | undefined;
    const def = readRosterDef(fieldSchema);
    const action = readRosterActions(fieldSchema)[input.action];
    if (!def || !action) return { status: 409, error: 'This action is no longer offered' };

    // 2. The entry, on the roster the server computes
    const ctx = hostContext(host as unknown as Record<string, unknown>);
    const roster = await loadRoster(def, ctx);
    const entry = roster.entries.find((e) => e.key === input.entry);
    const kind = rosterActionKind(action)!;
    const batch = 'batch' in def.expected;
    if (!entry || (kind === ROSTER_ACTION_KINDS.RESOLVE ? !entry.row : !batch)) {
      return { status: 409, error: 'This entry no longer offers that action' };
    }
    if (kind === ROSTER_ACTION_KINDS.FILL && action.fill?.enterCode
      && !enteredCodeMatches(String(input.code ?? ''), entry.key, def.countedBy)) {
      const error = `That code is not ${printedKeyCode(entry.key, def.countedBy)}.`;
      return { status: 422, error, data: { error, outcome: 'code_mismatch' } };
    }

    // 3. The person acting: the badge's person when one rides the request, read without spending it
    let actor = auth;
    if (input.actingToken) {
      const peeked = await peekActingAuth(input.actingToken);
      if (!peeked.ok) return refusal(401, ROSTER_ACTION_OUTCOMES.NOT_PRIMED, peeked.error);
      actor = peeked.auth;
    }
    if (!(await holdsRole(action, actor.userId))) {
      return input.actingToken
        ? refusal(403, ROSTER_ACTION_OUTCOMES.ROLE_REFUSED, actionRefusal(action))
        : refusal(403, ROSTER_ACTION_OUTCOMES.NEEDS_BADGE, actionRefusal(action));
    }

    // 4. Spend the badge, run the act, and return the use when it does not land
    let remaining: number | null | undefined;
    if (input.actingToken) {
      const spent = await consumeActingGrant(input.actingToken);
      if (!spent.ok) return refusal(401, ROSTER_ACTION_OUTCOMES.NOT_PRIMED, spent.error);
      remaining = spent.grant.remaining;
    }
    const result = await runAct(kind, action, entry, host.id, ctx, input.code, actor);
    if (input.actingToken && result.status >= 300) {
      await refundActingGrant(input.actingToken, false);
      return result;
    }
    if (input.actingToken && result.data && typeof result.data === 'object') {
      result.data = { ...result.data, acting: { remaining } };
    }
    return result;
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}

async function holdsRole(action: RosterActionDef, userId: string): Promise<boolean> {
  if (!action.roles?.length) return true;
  const [roles, superadmin] = await Promise.all([
    userService.getUserRoles(userId),
    userService.isSuperAdmin(userId),
  ]);
  return holdsActionRole(action, roles.map((r) => r.role), superadmin);
}

function runAct(
  kind: string,
  action: RosterActionDef,
  entry: RosterEntry,
  hostId: string,
  ctx: ShowIfContext,
  code: string | undefined,
  actor: LTApiAuth,
): Promise<LTApiResult> {
  switch (kind) {
    case ROSTER_ACTION_KINDS.RESOLVE:
      return resolveEscalation({
        id: String(entry.row!.escalation.id),
        resolverPayload: interpolatePayload(action.resolverPayload, entry.row!) as Record<string, any>,
      }, actor);
    case ROSTER_ACTION_KINDS.FILL:
      return resolveBatchItem({
        id: hostId,
        itemKey: entry.key,
        resolverPayload: {
          ...(interpolatePayload(action.fill?.payload ?? {}, ctx) as Record<string, any>),
          ...(action.fill?.enterCode ? { [ENTERED_CODE_KEY]: String(code).trim() } : {}),
        },
      }, actor);
    case ROSTER_ACTION_KINDS.FLAG:
      return flagBatchItem({
        id: hostId,
        itemKey: entry.key,
        label: action.flag!.label,
        ...(action.flag!.payload ? { payload: interpolatePayload(action.flag!.payload, ctx) as Record<string, any> } : {}),
      }, actor);
    default:
      return unflagBatchItem({ id: hostId, itemKey: entry.key }, actor);
  }
}

function refusal(status: number, outcome: string, error: string): LTApiResult {
  return { status, error, data: { error, outcome } };
}
