import { Router } from '../lib/http';

import * as escalationsApi from '../api/escalations';
import { requireAdmin, requireRoleManager } from '../modules/auth';
import { getMachineSurface } from '../modules/machines';
import { commandRow, commandTarget } from '../services/machines/commands';
import { LineVersionConflict, getLineWithHealth, listLines, listSites, type LineListQuery, type LineRecordWithHealth } from '../services/machines/registry';
import { declareLine, retireLine } from '../services/machines/registry-sync';
import { summarizeLine, type LineSurface } from '../services/machines/surface';
import type { LineIndex, LineIndexRow } from '../types/machines-view';

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

/** The raw wire payload as a string: a JSON body is serialized, text passes through. */
function payloadOf(body: unknown): string {
  if (typeof body === 'string') return body;
  if (body === undefined || body === null) return '';
  return JSON.stringify(body);
}

const SORTS = new Set(['attention', 'site', 'updated']);

function queryString(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

function queryBoolean(v: unknown): boolean | undefined {
  return v === 'true' ? true : v === 'false' ? false : undefined;
}

function queryInt(v: unknown): number | undefined {
  const n = typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : undefined;
}

/** A registry row as the index shows it: the surface's own summary when it runs the line, the stored definition otherwise. */
function toIndexRow(surface: LineSurface, record: LineRecordWithHealth): LineIndexRow {
  const running = surface.findLine(record.siteId, record.lineId);
  const summary = running
    ? surface.describeLines().find((l) => l.siteId === record.siteId && l.lineId === record.lineId) ?? summarizeLine(record.definition, {})
    : summarizeLine(record.definition, {});
  return {
    ...summary,
    source: record.source, version: record.version, enabled: record.enabled, updatedAt: record.updatedAt,
    leading: surface.describeLine(record.siteId, record.lineId) !== null,
    health: record.health,
  };
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
    lines: page.lines.map((record) => toIndexRow(surface, record)),
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
  const siteId = String(req.params.siteId);
  const lineId = String(req.params.lineId);
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
    const stored = (await getLineWithHealth(siteId, lineId)) ?? { ...record, health: emptyHealth(record.definition.machines.length) };
    res.status(200).json({ line: toIndexRow(surface, stored) });
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
  const siteId = String(req.params.siteId);
  const lineId = String(req.params.lineId);
  const record = await retireLine(surface, siteId, lineId);
  if (!record) {
    res.status(404).json({ error: `no line ${siteId}/${lineId}` });
    return;
  }
  res.status(204).end();
});

function emptyHealth(machines: number): LineRecordWithHealth['health'] {
  return { machines, offline: 0, quiet: 0, alarms: 0, people: 0, handoff: 0, command: 0, attention: false };
}

router.get('/lines/:siteId/:lineId', requireRoleManager, (req, res) => {
  const { surface, siteId, lineId, line } = lineOf(req);
  if (!surface || !line) {
    res.status(404).json({ error: surface ? `no line ${siteId}/${lineId}` : NO_LINES });
    return;
  }
  res.status(200).json(surface.describeLine(siteId, lineId) ?? { siteId, lineId, leading: false });
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
  const result = surface.inspect(siteId, lineId, { topic, payload: payloadOf(req.body?.payload), retained: req.body?.retained === true });
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
