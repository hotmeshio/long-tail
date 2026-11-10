/**
 * Identifier bindings: a scanned value (raw) paired with the thing it stands
 * for (target), under one scan scheme. A raw has one live target; a scheme
 * whose identifier sets `exclusiveTarget` also holds one live raw per target.
 * Retired rows are kept. The partial unique indexes decide concurrent binds,
 * so every write is one guarded statement, or a few in one transaction.
 */

import type { PoolClient } from 'pg';

import { getPool } from '../../lib/db';
import { isUuid } from '../../lib/uuid';
import type { BindingQuery, BoundVia, IdentifierBinding, ScanScheme } from '../../types';
import { getScanScheme } from '../scan-code';
import { LIST_LIMIT_DEFAULT, LIST_LIMIT_MAX, RAW_MAX, TARGET_MAX } from './constants';
import { BindingError } from './errors';
import { INSERT_BINDING, LIST_BINDINGS, LIVE_BY_RAW, RETIRE_BY_ID, RETIRE_RAW, RETIRE_TARGET_OTHERS } from './sql';

export interface BindingActor {
  /** The user or bot binding; recorded only when it is a user id. */
  userId?: string;
  via: BoundVia;
}

export interface BindResult {
  binding: IdentifierBinding;
  /** The raw was already bound to this target: nothing changed. */
  already: boolean;
  /** Bindings this one retired: the raw's old target, or the target's old raw. */
  retired: IdentifierBinding[];
}

const actorId = (actor: BindingActor): string | null => (actor.userId && isUuid(actor.userId) ? actor.userId : null);

/** The scheme bindings are kept under; throws 404 when it does not exist. */
export async function bindingScheme(version: number): Promise<ScanScheme> {
  const scheme = Number.isInteger(version) ? await getScanScheme(version) : null;
  if (!scheme) throw new BindingError(404, `scan scheme ${version} does not exist`);
  return scheme;
}

function assertPair(raw: string, target?: string): void {
  if (typeof raw !== 'string' || !raw.trim() || raw.length > RAW_MAX) throw new BindingError(400, `raw must be a non-empty string of at most ${RAW_MAX} characters`);
  if (target === undefined) return;
  if (typeof target !== 'string' || !target.trim() || target.length > TARGET_MAX) throw new BindingError(400, `target must be a non-empty string of at most ${TARGET_MAX} characters`);
}

async function inTransaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** Why an insert came back empty: the raw is live (on this target, or another), or the target is taken. */
async function refusal(client: PoolClient, scheme: ScanScheme, raw: string, target: string): Promise<IdentifierBinding> {
  const { rows } = await client.query(LIVE_BY_RAW, [scheme.version, raw]);
  if (rows[0]?.target === target) return rows[0];
  if (rows[0]) throw new BindingError(409, `this value is already bound under scheme ${scheme.version}`);
  throw new BindingError(409, `the target was bound under scheme ${scheme.version} at the same time; try again`);
}

/**
 * Bind `raw` to `target`. A raw already bound elsewhere is refused (409); the
 * same pair again is answered `already`. Under an exclusive scheme the target's
 * old raw is retired in the same transaction.
 */
export async function bind(schemeVersion: number, raw: string, target: string, actor: BindingActor): Promise<BindResult> {
  assertPair(raw, target);
  const scheme = await bindingScheme(schemeVersion);
  const exclusive = scheme.identifier?.exclusiveTarget === true;
  const by = actorId(actor);
  return inTransaction(async (client) => {
    const retired = exclusive ? (await client.query(RETIRE_TARGET_OTHERS, [scheme.version, target, raw, by])).rows : [];
    const { rows } = await client.query(INSERT_BINDING, [scheme.version, raw, target, exclusive, by, actor.via]);
    if (rows[0]) return { binding: rows[0], already: false, retired };
    const held = await refusal(client, scheme, raw, target);
    // The pair already stands; anything retired above was another raw on an exclusive target, which cannot be live beside it.
    return { binding: held, already: true, retired };
  });
}

/** Move `raw` to `target`: its old binding is retired (and the target's old raw, when exclusive), then the new one inserted. */
export async function rebind(schemeVersion: number, raw: string, target: string, actor: BindingActor): Promise<BindResult> {
  assertPair(raw, target);
  const scheme = await bindingScheme(schemeVersion);
  const exclusive = scheme.identifier?.exclusiveTarget === true;
  const by = actorId(actor);
  return inTransaction(async (client) => {
    const { rows: live } = await client.query(LIVE_BY_RAW, [scheme.version, raw]);
    if (live[0]?.target === target) return { binding: live[0], already: true, retired: [] };
    const retired = [
      ...(await client.query(RETIRE_RAW, [scheme.version, raw, by])).rows,
      ...(exclusive ? (await client.query(RETIRE_TARGET_OTHERS, [scheme.version, target, raw, by])).rows : []),
    ];
    const { rows } = await client.query(INSERT_BINDING, [scheme.version, raw, target, exclusive, by, actor.via]);
    if (!rows[0]) await refusal(client, scheme, raw, target);
    return { binding: rows[0], already: false, retired };
  });
}

/** Retire one binding; null when it is not live under the scheme. */
export async function retire(schemeVersion: number, id: string, actor: BindingActor): Promise<IdentifierBinding | null> {
  const scheme = await bindingScheme(schemeVersion);
  if (!/^\d+$/.test(String(id))) return null;
  const { rows } = await getPool().query(RETIRE_BY_ID, [scheme.version, id, actorId(actor)]);
  return rows[0] ?? null;
}

/** The live binding of a raw; null when it is unbound. */
export async function resolveBinding(schemeVersion: number, raw: string): Promise<IdentifierBinding | null> {
  assertPair(raw);
  const { rows } = await getPool().query(LIVE_BY_RAW, [schemeVersion, raw]);
  return rows[0] ?? null;
}

/** Live bindings (or every binding, with `includeRetired`), newest first. */
export async function listBindings(schemeVersion: number, query: BindingQuery = {}): Promise<IdentifierBinding[]> {
  const limit = Math.min(Math.max(1, Math.floor(query.limit ?? LIST_LIMIT_DEFAULT)), LIST_LIMIT_MAX);
  const offset = Math.max(0, Math.floor(query.offset ?? 0));
  const { rows } = await getPool().query(LIST_BINDINGS, [
    schemeVersion, query.target ?? null, query.raw ?? null, query.includeRetired === true, limit, offset,
  ]);
  return rows;
}
