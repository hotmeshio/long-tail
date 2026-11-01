import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { migrate } from '../../../lib/db/migrate';
import { getPool } from '../../../lib/db';
import { DEFAULT_LINE } from '../../../examples/workflows/machine-line/line';
import {
  LineVersionConflict, applyCodeLine, applyDeclaredLines, declareApiLine, deleteLine, getLine,
  listEnabledLines, listLines, listSites, searchTextOf,
} from '../../../services/machines/registry';
import type { LineDef } from '../../../lib/machines/line';

// The line registry: code and API declarations in one table, the configSource
// rules at boot, versions on every change, and the index's search.

const SITE = `reg-${Date.now().toString(36)}`;
const line = (lineId: string, patch: Partial<LineDef> = {}): LineDef => ({ ...DEFAULT_LINE, siteId: SITE, lineId, ...patch });

describe('line registry', () => {
  beforeAll(async () => {
    await migrate();
  }, 30_000);

  afterAll(async () => {
    await getPool().query('DELETE FROM lt_machine_lines WHERE site_id = $1', [SITE]);
  });

  it('indexes the line by site, line, machine ids, processes, roles and addresses', () => {
    const text = searchTextOf(line('l-1', { machines: [{ ...DEFAULT_LINE.machines[0], address: 'ADDR-9' }] }));
    expect(text).toBe(`${SITE} l-1 press-01 bond line-bond addr-9`);
  });

  it('an API declaration inserts at version 1, replaces at version 2, and refuses a stale version', async () => {
    const first = await declareApiLine(line('api-1'));
    expect(first).toMatchObject({ siteId: SITE, lineId: 'api-1', source: 'api', version: 1, enabled: true });
    const second = await declareApiLine(line('api-1', { machines: DEFAULT_LINE.machines.slice(0, 2) }), 1);
    expect(second.version).toBe(2);
    expect(second.definition.machines).toHaveLength(2);
    await expect(declareApiLine(line('api-1'), 1)).rejects.toBeInstanceOf(LineVersionConflict);
    expect((await getLine(SITE, 'api-1'))!.version).toBe(2);
  });

  it('refuses a definition the gateway could not run', async () => {
    await expect(declareApiLine(line('bad', { machines: [] }))).rejects.toThrow(/no machines/);
  });

  it('a db-owned code line is inserted once and never overwritten; a code-owned one follows the code', async () => {
    expect(await applyCodeLine(line('code-1'), false)).toBe('applied');
    expect(await applyCodeLine(line('code-1', { machines: DEFAULT_LINE.machines.slice(0, 1) }), false)).toBe('db-owned');
    expect((await getLine(SITE, 'code-1'))!.definition.machines).toHaveLength(3);

    expect(await applyCodeLine(line('code-1', { machines: DEFAULT_LINE.machines.slice(0, 1) }), true)).toBe('applied');
    const changed = await getLine(SITE, 'code-1');
    expect(changed!.version).toBe(2);
    expect(changed!.definition.machines).toHaveLength(1);
    expect(await applyCodeLine(line('code-1', { machines: DEFAULT_LINE.machines.slice(0, 1) }), true)).toBe('unchanged');
    expect((await getLine(SITE, 'code-1'))!.version).toBe(2);
  });

  it('boot reports what it applied and names code lines it no longer declares, leaving them in place', async () => {
    await applyCodeLine(line('code-old'), true);
    const report = await applyDeclaredLines([line('code-1', { machines: DEFAULT_LINE.machines.slice(0, 1) }), line('code-2')], true);
    expect(report.applied).toEqual([`${SITE}/code-2`]);
    expect(report.unchanged).toEqual([`${SITE}/code-1`]);
    expect(report.orphans).toContain(`${SITE}/code-old`);
    expect(await getLine(SITE, 'code-old')).not.toBeNull();
  });

  it('lists every enabled line for a replica to contend for, searches the index, and counts sites', async () => {
    const enabled = await listEnabledLines();
    expect(enabled.filter((l) => l.siteId === SITE).map((l) => l.lineId)).toEqual(['api-1', 'code-1', 'code-2', 'code-old']);

    const byMachine = await listLines({ q: 'cut-01', site: SITE });
    expect(byMachine.lines.map((l) => l.lineId)).toEqual(['api-1', 'code-2', 'code-old']);
    expect(byMachine.total).toBe(3);
    expect(byMachine.lines[0].health).toEqual({ machines: 2, offline: 0, quiet: 0, alarms: 0, people: 0, handoff: 0, command: 0, attention: false });

    const byProcess = await listLines({ q: 'BOND', site: SITE, sort: 'updated' });
    expect(byProcess.total).toBe(4);
    expect((await listLines({ q: '%', site: SITE })).total).toBe(0);

    const page = await listLines({ site: SITE, sort: 'site', limit: 2, offset: 2 });
    expect(page.lines.map((l) => l.lineId)).toEqual(['code-2', 'code-old']);
    expect(page).toMatchObject({ total: 4, limit: 2, offset: 2 });

    const site = (await listSites()).find((s) => s.siteId === SITE);
    expect(site).toEqual({ siteId: SITE, lines: 4, attention: 0 });
  });

  it('deletes a line and says when there was none', async () => {
    expect((await deleteLine(SITE, 'code-old'))!.lineId).toBe('code-old');
    expect(await deleteLine(SITE, 'code-old')).toBeNull();
  });
});
