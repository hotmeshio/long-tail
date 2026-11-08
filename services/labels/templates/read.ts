import { getPool } from '../../../lib/db';
import type { LabelTemplate } from '../../../types/labels';
import { GET_TEMPLATE, LIST_TEMPLATES, LIST_TEMPLATES_BY_SCHEME } from './sql';

export function mapTemplate(row: any): LabelTemplate {
  return {
    name: row.name,
    scheme_version: row.scheme_version,
    title: row.title,
    description: row.description ?? null,
    codes: row.codes ?? [],
    text: row.text ?? {},
    symbology: row.symbology,
    human_readable: row.human_readable,
    media: row.media ?? null,
    sensitive: row.sensitive,
    enabled: row.enabled,
    revision: row.revision,
    source: row.source,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function listLabelTemplates(schemeVersion?: number): Promise<LabelTemplate[]> {
  const { rows } = schemeVersion === undefined
    ? await getPool().query(LIST_TEMPLATES)
    : await getPool().query(LIST_TEMPLATES_BY_SCHEME, [schemeVersion]);
  return rows.map(mapTemplate);
}

export async function getLabelTemplate(name: string): Promise<LabelTemplate | null> {
  const { rows } = await getPool().query(GET_TEMPLATE, [name]);
  return rows[0] ? mapTemplate(rows[0]) : null;
}
