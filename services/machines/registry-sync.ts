/**
 * Keeps the running surface in step with the line registry. A declaration
 * through the API writes the registry, applies the line's roles, runs the
 * line on this replica and tells every other replica, which reads the row
 * again and follows. Boot applies the code lines the same way, then starts
 * the surface with everything the registry holds.
 */

import type { CallbackEventAdapter } from '../../lib/events/callback';
import { publishMachineLineEvent } from '../../lib/events/publish';
import { withConfigLock } from '../../lib/db/config-lock';
import { loggerRegistry } from '../../lib/logger';
import type { LineDef } from '../../lib/machines/line';
import { isTopicLevel } from '../../lib/machines/protocol/topics';
import type { LTEvent } from '../../types';
import { applyRoleConfig } from '../role/seed';
import { applyDeclaredLines, declareApiLine, deleteLine, getLine, listEnabledLines, type LineApplyReport, type LineRecord } from './registry';
import { machineRoleConfigs } from './roles';
import type { LineSurface } from './surface';

const LINE_EVENTS = 'machine.line.>';
const LOG = '[lt-machines]';

export const LINE_ACTION = { DECLARED: 'declared', RETIRED: 'retired' } as const;

/** The line's station, exit and operator roles, where the host declared none. */
async function applyLineRoles(line: LineDef): Promise<void> {
  await withConfigLock(async () => {
    for (const cfg of machineRoleConfigs(line)) await applyRoleConfig(cfg, false);
  });
}

/** Declare a line through the API on this replica, then tell the others. */
export async function declareLine(surface: LineSurface, def: LineDef, expectedVersion?: number): Promise<LineRecord> {
  const record = await declareApiLine(def, expectedVersion);
  await applyLineRoles(record.definition);
  await surface.declare(record.definition);
  await publishMachineLineEvent({ siteId: record.siteId, lineId: record.lineId, source: record.source, version: record.version, action: LINE_ACTION.DECLARED });
  return record;
}

/** Retire a line on this replica and in the registry, then tell the others. Roles and bot accounts stay. */
export async function retireLine(surface: LineSurface, siteId: string, lineId: string): Promise<LineRecord | null> {
  const record = await deleteLine(siteId, lineId);
  if (!record) return null;
  await surface.retire(siteId, lineId);
  await publishMachineLineEvent({ siteId, lineId, source: record.source, version: record.version, action: LINE_ACTION.RETIRED });
  return record;
}

/** Boot: apply code lines under the configSource rules, then every enabled line the registry holds. */
export async function syncDeclaredLines(lines: LineDef[], codeOwned: boolean): Promise<{ report: LineApplyReport; lines: LineDef[] }> {
  const report = await withConfigLock(() => applyDeclaredLines(lines, codeOwned));
  const enabled = await listEnabledLines();
  return { report, lines: enabled.map((r) => r.definition) };
}

/**
 * Follow registry changes other replicas publish. The event only names the
 * line: the registry row is read again and decides, so a stray or stale
 * event cannot stop a line the registry still holds. The surface ignores a
 * line it already runs unchanged.
 */
export function watchLineRegistry(surface: LineSurface, callbacks: CallbackEventAdapter): () => void {
  return callbacks.on(LINE_EVENTS, (event: LTEvent) => {
    const data = (event.data ?? {}) as { siteId?: unknown; lineId?: unknown };
    if (!isTopicLevel(data.siteId) || !isTopicLevel(data.lineId)) return;
    const { siteId, lineId } = data;
    void follow(surface, siteId, lineId).catch((err) => {
      loggerRegistry.warn(`${LOG} following ${siteId}/${lineId} failed: ${err instanceof Error ? err.message : String(err)}`);
    });
  });
}

async function follow(surface: LineSurface, siteId: string, lineId: string): Promise<void> {
  const record = await getLine(siteId, lineId);
  if (!record || !record.enabled) {
    await surface.retire(siteId, lineId);
    return;
  }
  const outcome = await surface.declare(record.definition);
  if (outcome !== 'unchanged') loggerRegistry.info(`${LOG} line ${siteId}/${lineId} ${outcome} from the registry (v${record.version})`);
}
