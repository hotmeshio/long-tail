import { getPool } from '../../../lib/db';
import { SCAN_SCHEME_KINDS } from '../../../types';
import type { LabelTemplate, LabelTemplateInput } from '../../../types/labels';
import { getScanScheme, listScanRules } from '../../scan-code';
import { getIdentityPropertyKeys } from '../../user';
import { labelMediaPresets } from '../media';
import { mapTemplate } from './read';
import { APPLY_TEMPLATE, DELETE_TEMPLATE, GET_TEMPLATE, SEED_TEMPLATE, UPSERT_TEMPLATE } from './sql';
import { assertValidTemplate } from './validate';

/** An API write raced another: the stored revision is not the one the caller read. */
export class LabelTemplateConflictError extends Error {
  status = 409;
  constructor(name: string, revision: number) {
    super(`label template "${name}" changed (now revision ${revision}); reload and try again`);
    this.name = 'LabelTemplateConflictError';
  }
}

async function validated(input: LabelTemplateInput): Promise<LabelTemplateInput & { sensitive: boolean }> {
  const [scheme, rules, identityKeys] = await Promise.all([
    getScanScheme(input.scheme_version),
    listScanRules(input.scheme_version),
    getIdentityPropertyKeys(),
  ]);
  assertValidTemplate(input, { scheme, rules, identityKeys, mediaIds: labelMediaPresets().map((m) => m.id) });
  return { ...input, sensitive: scheme!.kind === SCAN_SCHEME_KINDS.IDENTITY || !!input.sensitive };
}

function params(input: LabelTemplateInput & { sensitive: boolean }, source: 'code' | 'api'): unknown[] {
  return [
    input.name,
    input.scheme_version,
    input.title,
    input.description ?? null,
    JSON.stringify(input.codes.map((c) => ({ category: c.category, caption: c.caption ?? null, tone: c.tone }))),
    JSON.stringify({ title: input.text?.title ?? '', lines: input.text?.lines ?? [] }),
    input.symbology ?? 'code128',
    input.human_readable ?? true,
    input.media ?? null,
    input.sensitive,
    input.enabled ?? true,
    source,
  ];
}

/**
 * Create or replace a template from the API. With `expectedRevision`, the
 * write lands only on that revision; otherwise LabelTemplateConflictError.
 */
export async function upsertLabelTemplate(input: LabelTemplateInput, expectedRevision?: number): Promise<LabelTemplate> {
  const row = await validated(input);
  const { rows } = await getPool().query(UPSERT_TEMPLATE, [...params(row, 'api'), expectedRevision ?? null]);
  if (rows[0]) return mapTemplate(rows[0]);
  const current = await getPool().query(GET_TEMPLATE, [input.name]);
  throw new LabelTemplateConflictError(input.name, current.rows[0]?.revision ?? 0);
}

export async function deleteLabelTemplate(name: string): Promise<boolean> {
  const { rowCount } = await getPool().query(DELETE_TEMPLATE, [name]);
  return (rowCount ?? 0) > 0;
}

/** Insert a template only when absent (database-owned configuration). */
export async function seedLabelTemplate(input: LabelTemplateInput): Promise<boolean> {
  const { rowCount } = await getPool().query(SEED_TEMPLATE, params(await validated(input), 'api'));
  return (rowCount ?? 0) > 0;
}

/** Apply a template declared in code; unchanged declarations write nothing. */
export async function applyLabelTemplate(input: LabelTemplateInput): Promise<'applied' | 'unchanged'> {
  const { rowCount } = await getPool().query(APPLY_TEMPLATE, params(await validated(input), 'code'));
  return (rowCount ?? 0) > 0 ? 'applied' : 'unchanged';
}
