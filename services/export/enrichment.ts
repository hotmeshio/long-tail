import type { WorkflowExecution } from '@hotmeshio/hotmesh/build/types/exporter';

import { getPool } from '../db';
import { parseHmshValue } from './parsers';
import { RESOLVE_SYMBOL, GET_ACTIVITY_INPUTS } from './sql';

// ── Symbol resolution ────────────────────────────────────────────────────────

/**
 * Resolve a HotMesh symbolic field name from a stable JSON path.
 *
 * HotMesh compresses JSON paths (e.g., `trigger/output/data/arguments`)
 * into 3-letter symbol codes (e.g., `aag`) stored in `durable.symbols`.
 * This function looks up the symbol for a given path within a named
 * symbol range, so callers never need to hardcode magic symbol strings.
 *
 * Results are cached in-process -- symbol mappings are static for the
 * lifetime of a durable namespace.
 */
const symbolCache = new Map<string, string | null>();

async function resolveSymbol(
  range: string,
  path: string,
  dimension = 0,
): Promise<string | null> {
  const cacheKey = `${range}:${path}:${dimension}`;
  if (symbolCache.has(cacheKey)) return symbolCache.get(cacheKey)!;

  const pool = getPool();
  const result = await pool.query(RESOLVE_SYMBOL, [
    `hmsh:durable:sym:keys:${range}`,
    path,
  ]);
  const resolved = result.rows.length > 0
    ? `${result.rows[0].value},${dimension}`
    : null;
  symbolCache.set(cacheKey, resolved);
  return resolved;
}

// ── Event input enrichment ───────────────────────────────────────────────────

/**
 * Enrich activity events with their input arguments by fetching them from
 * the activity job hashes in the DB.
 *
 * HotMesh stores each proxy activity as a separate job. The activity's
 * trigger stores the arguments under a symbolic field. The parent
 * workflow's timeline entry only stores the output -- this function
 * fills in the missing `input` on each activity_task_scheduled and
 * activity_task_completed event.
 */
export async function enrichEventInputs(execution: WorkflowExecution): Promise<void> {
  const pool = getPool();
  const workflowId = execution.workflow_id;

  // Resolve symbols from stable JSON paths (never hardcode symbol codes)
  const [activityArgsField, workflowArgsField] = await Promise.all([
    resolveSymbol('activity_trigger', 'activity_trigger/output/data/arguments'),
    resolveSymbol('trigger', 'trigger/output/data/arguments'),
  ]);

  // ── 1. Activity inputs ──
  const activityEvents = execution.events.filter(
    (e) => e.event_type === 'activity_task_scheduled' || e.event_type === 'activity_task_completed',
  );

  if (activityEvents.length > 0 && activityArgsField) {
    const jobKeyPattern = `hmsh:durable:j:-${workflowId}-%`;

    const result = await pool.query(GET_ACTIVITY_INPUTS, [
      jobKeyPattern,
      activityArgsField,
    ]);

    const inputByJobId = new Map<string, unknown>();
    const inputByNameIndex = new Map<string, unknown>();

    for (const row of result.rows) {
      const jobId = (row.key as string).replace('hmsh:durable:j:', '');
      try {
        const parsed = parseHmshValue(row.value);
        inputByJobId.set(jobId, parsed);
        const match = jobId.match(/\$([^-]+)-(\d+)$/);
        if (match) {
          inputByNameIndex.set(`${match[1]}:${match[2]}`, parsed);
        }
      } catch {
        // skip unparseable
      }
    }

    for (const evt of activityEvents) {
      const attrs = evt.attributes as any;
      let input = attrs.timeline_key ? inputByJobId.get(attrs.timeline_key) : undefined;
      if (input === undefined && attrs.activity_type && attrs.execution_index !== undefined) {
        input = inputByNameIndex.get(`${attrs.activity_type}:${attrs.execution_index}`);
      }
      if (input !== undefined) {
        attrs.input = input;
      }
    }
  }

  // ── 2. Child workflow inputs ──
  const childEvents = execution.events.filter(
    (e) => e.event_type === 'child_workflow_execution_started',
  );

  if (childEvents.length > 0 && workflowArgsField) {
    const childIds = [...new Set(
      childEvents
        .map((e) => (e.attributes as any).child_workflow_id as string)
        .filter(Boolean),
    )];

    if (childIds.length > 0) {
      const childJobKeys = childIds.map((id) => `hmsh:durable:j:${id}`);
      const placeholders = childJobKeys.map((_, i) => `$${i + 1}`).join(',');

      const result = await pool.query(
        `SELECT j.key, ja.value
         FROM durable.jobs j
         JOIN durable.jobs_attributes ja ON ja.job_id = j.id
         WHERE j.key IN (${placeholders})
           AND ja.field = $${childJobKeys.length + 1}`,
        [...childJobKeys, workflowArgsField],
      );

      const childInputMap = new Map<string, unknown>();
      for (const row of result.rows) {
        const childId = (row.key as string).replace('hmsh:durable:j:', '');
        try {
          childInputMap.set(childId, parseHmshValue(row.value));
        } catch {
          // skip unparseable
        }
      }

      for (const evt of childEvents) {
        const attrs = evt.attributes as any;
        const input = childInputMap.get(attrs.child_workflow_id);
        if (input !== undefined) {
          attrs.input = input;
        }
      }
    }
  }
}
