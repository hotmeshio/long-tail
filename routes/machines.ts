import { Router } from '../lib/http';

import * as escalationsApi from '../api/escalations';
import { requireAdmin, requireRoleManager } from '../modules/auth';
import { getMachineSurface } from '../modules/machines';
import { commandRow, commandTarget } from '../services/machines/commands';
import { LineVersionConflict, getLineWithHealth, listLines, listSites, type LineListQuery } from '../services/machines/registry';
import { declareLine, retireLine } from '../services/machines/registry-sync';
import { emptyLineHealth, lineSummaryOf, toLineIndexRow, wirePayloadOf } from '../services/machines/line-index';
import { isTopicLevel } from '../lib/machines/protocol/topics';
import type { LineIndex, LineViewResponse } from '../types/machines-view';

const router = Router();

/**
 * The machine surface for the dashboard's Lines view. Reads and the dry run
 * take the ops tier (superadmin, admin type, or engineer); declaring and
 * retiring a line takes an administrator. A command is a row parked on the
 * machine's role as the caller, so that role's write access decides, exactly
 * as it does for any row created through the API.
 */

const NO_LINES = 'no machine lines are declared';
const NOT_LEADING = 'this replica is not leading the line';

function lineOf(req: { params: Record<string, string | string[]> }) {
  const surface = getMachineSurface();
  const siteId = String(req.params.siteId);
  const lineId = String(req.params.lineId);
  const line = surface?.findLine(siteId, lineId);
  return { surface, siteId, lineId, line };
}

const SORTS = new Set(['attention', 'site', 'updated']);
/** The longest search a person types; anything past it is cut, never an error. */
const QUERY_MAX_CHARS = 200;

function queryString(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim().slice(0, QUERY_MAX_CHARS) : undefined;
}

/** The line a path names, when both tokens could name a line at all. */
function pathLine(req: { params: Record<string, string | string[]> }): { siteId: string; lineId: string } | null {
  const siteId = req.params.siteId;
  const lineId = req.params.lineId;
  return isTopicLevel(siteId) && isTopicLevel(lineId) ? { siteId, lineId } : null;
}

function queryBoolean(v: unknown): boolean | undefined {
  return v === 'true' ? true : v === 'false' ? false : undefined;
}

function queryInt(v: unknown): number | undefined {
  const n = typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : undefined;
}


router.get('/lines', requireRoleManager, async (req, res) => {
  const surface = getMachineSurface();
  if (!surface) {
    res.status(404).json({ error: NO_LINES });
    return;
  }
  const sort = queryString(req.query.sort);
  if (sort && !SORTS.has(sort)) {
    res.status(400).json({ error: `sort must be one of ${[...SORTS].join(', ')}` });
    return;
  }
  const query: LineListQuery = {
    q: queryString(req.query.q), site: queryString(req.query.site), attention: queryBoolean(req.query.attention),
    sort: sort as LineListQuery['sort'], limit: queryInt(req.query.limit), offset: queryInt(req.query.offset),
  };
  const [page, sites] = await Promise.all([listLines(query), listSites()]);
  const body: LineIndex = {
    lines: page.lines.map((record) => toLineIndexRow(surface, record)),
    total: page.total, sites, limit: page.limit, offset: page.offset,
  };
  res.status(200).json(body);
});

router.put('/lines/:siteId/:lineId', requireAdmin, async (req, res) => {
  const surface = getMachineSurface();
  if (!surface) {
    res.status(404).json({ error: NO_LINES });
    return;
  }
  const named = pathLine(req);
  if (!named) {
    res.status(400).json({ error: 'siteId and lineId must be topic levels' });
    return;
  }
  const { siteId, lineId } = named;
  const definition = req.body?.definition;
  if (!definition || typeof definition !== 'object' || Array.isArray(definition)) {
    res.status(400).json({ error: 'definition is required' });
    return;
  }
  if (definition.siteId !== siteId || definition.lineId !== lineId) {
    res.status(400).json({ error: `definition must be for ${siteId}/${lineId}` });
    return;
  }
  const version = req.body?.version;
  if (version !== undefined && !(Number.isInteger(version) && version >= 1)) {
    res.status(400).json({ error: 'version must be a whole number of at least 1' });
    return;
  }
  try {
    const record = await declareLine(surface, definition, version);
    const stored = (await getLineWithHealth(siteId, lineId)) ?? { ...record, health: emptyLineHealth(record.definition.machines.length) };
    res.status(200).json({ line: toLineIndexRow(surface, stored) });
  } catch (err) {
    if (err instanceof LineVersionConflict) {
      res.status(409).json({ error: err.message });
      return;
    }
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

router.delete('/lines/:siteId/:lineId', requireAdmin, async (req, res) => {
  const surface = getMachineSurface();
  if (!surface) {
    res.status(404).json({ error: NO_LINES });
    return;
  }
  const named = pathLine(req);
  if (!named) {
    res.status(404).json({ error: 'no such line' });
    return;
  }
  const { siteId, lineId } = named;
  const record = await retireLine(surface, siteId, lineId);
  if (!record) {
    res.status(404).json({ error: `no line ${siteId}/${lineId}` });
    return;
  }
  res.status(204).end();
});


router.get('/lines/:siteId/:lineId', requireRoleManager, (req, res) => {
  const { surface, siteId, lineId, line } = lineOf(req);
  if (!surface || !line) {
    res.status(404).json({ error: surface ? `no line ${siteId}/${lineId}` : NO_LINES });
    return;
  }
  const body: LineViewResponse = {
    ...(surface.describeLine(siteId, lineId) ?? { siteId, lineId, leading: false }),
    summary: lineSummaryOf(surface, siteId, lineId, line),
  };
  res.status(200).json(body);
});

router.post('/lines/:siteId/:lineId/inspect', requireRoleManager, (req, res) => {
  const { surface, siteId, lineId, line } = lineOf(req);
  if (!surface || !line) {
    res.status(404).json({ error: surface ? `no line ${siteId}/${lineId}` : NO_LINES });
    return;
  }
  const topic = req.body?.topic;
  if (typeof topic !== 'string' || !topic) {
    res.status(400).json({ error: 'topic is required' });
    return;
  }
  const result = surface.inspect(siteId, lineId, { topic, payload: wirePayloadOf(req.body?.payload), retained: req.body?.retained === true });
  if (!result) {
    res.status(409).json({ error: NOT_LEADING });
    return;
  }
  res.status(200).json(result);
});

router.post('/lines/:siteId/:lineId/machines/:machineId/commands', async (req, res) => {
  const { surface, siteId, lineId, line } = lineOf(req);
  if (!surface || !line) {
    res.status(404).json({ error: surface ? `no line ${siteId}/${lineId}` : NO_LINES });
    return;
  }
  const machineId = String(req.params.machineId);
  if (!line.machines.some((m) => m.machineId === machineId)) {
    res.status(404).json({ error: `no machine ${machineId} on ${siteId}/${lineId}` });
    return;
  }
  const op = req.body?.op;
  const ops = surface.commandOps(siteId, lineId);
  if (typeof op !== 'string' || !ops.includes(op)) {
    res.status(400).json({ error: `op must be one of ${ops.join(', ')}` });
    return;
  }
  const args = req.body?.args;
  if (args !== undefined && (!args || typeof args !== 'object' || Array.isArray(args))) {
    res.status(400).json({ error: 'args must be an object' });
    return;
  }
  const result = await escalationsApi.createEscalation(commandRow(commandTarget(line, machineId), op, args ?? {}), req.auth!);
  if (result.status !== 201) {
    res.status(result.status).json({ error: result.error });
    return;
  }
  res.status(201).json({ rowId: result.data.id });
});

export default router;
