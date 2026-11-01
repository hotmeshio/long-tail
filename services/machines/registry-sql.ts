/**
 * The line registry's statements. Every write is one statement: the
 * version advances in the same UPDATE that changes the row, and a version
 * check rides the WHERE so a stale writer gets zero rows back.
 */

import { ROW_TYPE } from './contracts';

export const LINE_SOURCE = { CODE: 'code', API: 'api' } as const;

const COLUMNS = 'site_id, line_id, definition, source, version, enabled, search_text, created_at, updated_at';

/** An API write: insert, or replace and advance the version; $5 non-null requires that version. */
export const UPSERT_API_LINE = `
  INSERT INTO lt_machine_lines (site_id, line_id, definition, source, search_text)
  VALUES ($1, $2, $3::jsonb, '${LINE_SOURCE.API}', $4)
  ON CONFLICT (site_id, line_id) DO UPDATE
    SET definition = EXCLUDED.definition,
        source = '${LINE_SOURCE.API}',
        search_text = EXCLUDED.search_text,
        enabled = true,
        version = lt_machine_lines.version + 1,
        updated_at = NOW()
    WHERE $5::int IS NULL OR lt_machine_lines.version = $5::int
  RETURNING ${COLUMNS}`;

/** A db-owned code line: first writer wins, an existing row is left as it is. */
export const SEED_CODE_LINE = `
  INSERT INTO lt_machine_lines (site_id, line_id, definition, source, search_text)
  VALUES ($1, $2, $3::jsonb, '${LINE_SOURCE.CODE}', $4)
  ON CONFLICT (site_id, line_id) DO NOTHING
  RETURNING ${COLUMNS}`;

/** A code-owned code line: written only when the definition or the owner differs, one version per change. */
export const APPLY_CODE_LINE = `
  INSERT INTO lt_machine_lines (site_id, line_id, definition, source, search_text)
  VALUES ($1, $2, $3::jsonb, '${LINE_SOURCE.CODE}', $4)
  ON CONFLICT (site_id, line_id) DO UPDATE
    SET definition = EXCLUDED.definition,
        source = '${LINE_SOURCE.CODE}',
        search_text = EXCLUDED.search_text,
        enabled = true,
        version = lt_machine_lines.version + 1,
        updated_at = NOW()
    WHERE lt_machine_lines.definition IS DISTINCT FROM EXCLUDED.definition
       OR lt_machine_lines.source <> '${LINE_SOURCE.CODE}'
       OR NOT lt_machine_lines.enabled
  RETURNING ${COLUMNS}`;

export const GET_LINE = `SELECT ${COLUMNS} FROM lt_machine_lines WHERE site_id = $1 AND line_id = $2`;

export const DELETE_LINE = `DELETE FROM lt_machine_lines WHERE site_id = $1 AND line_id = $2 RETURNING ${COLUMNS}`;

export const LIST_ENABLED_LINES = `SELECT ${COLUMNS} FROM lt_machine_lines WHERE enabled ORDER BY site_id, line_id`;

export const LIST_CODE_LINES = `SELECT site_id, line_id FROM lt_machine_lines WHERE source = '${LINE_SOURCE.CODE}'`;

/** The kinds of pending rows the index counts, in the order the health CTE projects them. */
export const HEALTH_ROW_TYPES = [
  ROW_TYPE.MACHINE_OFFLINE, ROW_TYPE.MACHINE_QUIET, ROW_TYPE.ALARM,
  ROW_TYPE.HANDOFF_ERROR, ROW_TYPE.CONTRACT_VIOLATION, ROW_TYPE.MACHINE_REGISTRATION,
  ROW_TYPE.HANDOFF, ROW_TYPE.MACHINE_COMMAND,
] as const;

const PENDING = 'pending';

/** Pending rows per line, counted by kind: $1 is the list of row types. */
const HEALTH_CTE = `
  health AS (
    SELECT metadata->>'siteId' AS site_id, metadata->>'lineId' AS line_id,
      COUNT(*) FILTER (WHERE type = '${ROW_TYPE.MACHINE_OFFLINE}')::int AS offline,
      COUNT(*) FILTER (WHERE type = '${ROW_TYPE.MACHINE_QUIET}')::int AS quiet,
      COUNT(*) FILTER (WHERE type = '${ROW_TYPE.ALARM}')::int AS alarms,
      COUNT(*) FILTER (WHERE type IN ('${ROW_TYPE.HANDOFF_ERROR}', '${ROW_TYPE.CONTRACT_VIOLATION}', '${ROW_TYPE.MACHINE_REGISTRATION}'))::int AS people,
      COUNT(*) FILTER (WHERE type = '${ROW_TYPE.HANDOFF}')::int AS handoff,
      COUNT(*) FILTER (WHERE type = '${ROW_TYPE.MACHINE_COMMAND}')::int AS command
    FROM public.lt_escalations
    WHERE status = '${PENDING}' AND type = ANY($1::text[]) AND metadata ? 'siteId' AND metadata ? 'lineId'
    GROUP BY 1, 2
  ),
  lines AS (
    SELECT l.${COLUMNS.split(', ').join(', l.')},
      COALESCE(h.offline, 0) AS offline, COALESCE(h.quiet, 0) AS quiet, COALESCE(h.alarms, 0) AS alarms,
      COALESCE(h.people, 0) AS people, COALESCE(h.handoff, 0) AS handoff, COALESCE(h.command, 0) AS command,
      (COALESCE(h.offline, 0) + COALESCE(h.alarms, 0) + COALESCE(h.people, 0)) > 0 AS attention
    FROM lt_machine_lines l
    LEFT JOIN health h ON h.site_id = l.site_id AND h.line_id = l.line_id
    WHERE l.enabled
  )`;

/** The index's order, by name; attention first within each. */
export const LINE_ORDER: Record<string, string> = {
  attention: 'attention DESC, (offline + alarms + people) DESC, site_id, line_id',
  site: 'site_id, line_id',
  updated: 'updated_at DESC, site_id, line_id',
};

/**
 * One page of the index: $1 row types, $2 search pattern or null, $3 site
 * or null, $4 attention or null, $5 limit, $6 offset, $7 line or null. The
 * total rides every row as a window count.
 */
export function listLinesSql(order: string): string {
  return `
  WITH ${HEALTH_CTE}
  SELECT *, COUNT(*) OVER() AS total
  FROM lines
  WHERE ($2::text IS NULL OR search_text ILIKE $2 ESCAPE '\\')
    AND ($3::text IS NULL OR site_id = $3)
    AND ($4::boolean IS NULL OR attention = $4)
    AND ($7::text IS NULL OR line_id = $7)
  ORDER BY ${order}
  LIMIT $5 OFFSET $6`;
}

/** Every site, with its lines and how many need attention: $1 row types. */
export const LIST_SITES = `
  WITH ${HEALTH_CTE}
  SELECT site_id, COUNT(*)::int AS lines, COUNT(*) FILTER (WHERE attention)::int AS attention
  FROM lines
  GROUP BY site_id
  ORDER BY site_id`;
