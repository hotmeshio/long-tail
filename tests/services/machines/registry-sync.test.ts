import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { migrate } from '../../../lib/db/migrate';
import { getPool } from '../../../lib/db';
import { CallbackEventAdapter } from '../../../lib/events/callback';
import { DEFAULT_LINE } from '../../../examples/workflows/machine-line/line';
import type { LineDef } from '../../../lib/machines/line';
import { declareApiLine, deleteLine, getLine } from '../../../services/machines/registry';
import { declareLine, retireLine, syncDeclaredLines, watchLineRegistry } from '../../../services/machines/registry-sync';
import type { LineSurface } from '../../../services/machines/surface';
import { until } from '../../../services/machines/testing';

// Replicas follow the registry: a declaration on one replica is an event the
// others read back from the table, so every replica runs the same lines.

const SITE = `sync-${Date.now().toString(36)}`;
const line = (lineId: string, machines = DEFAULT_LINE.machines): LineDef => ({ ...DEFAULT_LINE, siteId: SITE, lineId, machines });

function fakeSurface(calls: string[]): LineSurface {
  const running = new Map<string, LineDef>();
  return {
    describeLines: () => [],
    describeLine: () => null,
    inspect: () => null,
    findLine: (s, l) => running.get(`${s}/${l}`),
    commandOps: () => [],
    declare: async (def) => {
      const key = `${def.siteId}/${def.lineId}`;
      const outcome = !running.has(key) ? 'started' : running.get(key)!.machines.length === def.machines.length ? 'unchanged' : 'replaced';
      running.set(key, def);
      calls.push(`${outcome} ${key}`);
      return outcome;
    },
    retire: async (s, l) => {
      calls.push(`retire ${s}/${l}`);
      return running.delete(`${s}/${l}`);
    },
  };
}

describe('registry sync', () => {
  beforeAll(async () => {
    await migrate();
  }, 30_000);

  afterAll(async () => {
    await getPool().query('DELETE FROM lt_machine_lines WHERE site_id = $1', [SITE]);
    await getPool().query('DELETE FROM lt_roles WHERE role = ANY($1)', [['line-bond', 'line-trim', 'line-inspect']]);
  });

  it('a declaration lands in the registry, applies the line\'s roles, and runs the line here', async () => {
    const calls: string[] = [];
    const surface = fakeSurface(calls);
    const record = await declareLine(surface, line('a'));
    expect(record).toMatchObject({ siteId: SITE, lineId: 'a', source: 'api', version: 1 });
    expect(calls).toEqual([`started ${SITE}/a`]);
    const { rows } = await getPool().query('SELECT role FROM lt_roles WHERE role = ANY($1) ORDER BY role', [['line-bond', 'line-trim', 'line-inspect']]);
    expect(rows.map((r: any) => r.role)).toEqual(['line-bond', 'line-inspect', 'line-trim']);

    expect(await retireLine(surface, SITE, 'a')).toMatchObject({ lineId: 'a' });
    expect(calls).toEqual([`started ${SITE}/a`, `retire ${SITE}/a`]);
    expect(await retireLine(surface, SITE, 'a')).toBeNull();
    expect(await getLine(SITE, 'a')).toBeNull();
  });

  it('another replica\'s event makes this one read the row and follow; the row decides, not the event', async () => {
    const calls: string[] = [];
    const surface = fakeSurface(calls);
    const callbacks = new CallbackEventAdapter();
    const off = watchLineRegistry(surface, callbacks);
    const event = (action: string, lineId: string) => callbacks.publish({
      type: `machine.line.${SITE}.${lineId}.${action}`, source: 'machine-gateway', timestamp: new Date().toISOString(),
      data: { siteId: SITE, lineId, action },
    } as any);

    await declareApiLine(line('b'));
    await event('declared', 'b');
    await until(() => calls.length === 1);
    expect(calls).toEqual([`started ${SITE}/b`]);

    await event('declared', 'b');
    await until(() => calls.length === 2);
    expect(calls[1]).toBe(`unchanged ${SITE}/b`);

    await declareApiLine(line('b', DEFAULT_LINE.machines.slice(0, 1)));
    await event('declared', 'b');
    await until(() => calls.length === 3);
    expect(calls[2]).toBe(`replaced ${SITE}/b`);

    await event('retired', 'b');
    await until(() => calls.length === 4);
    expect(calls[3]).toBe(`unchanged ${SITE}/b`);

    await deleteLine(SITE, 'b');
    await event('retired', 'b');
    await until(() => calls.length === 5);
    expect(calls[4]).toBe(`retire ${SITE}/b`);

    await event('declared', 'gone');
    await until(() => calls.length === 6);
    expect(calls[5]).toBe(`retire ${SITE}/gone`);
    off();
  });

  it('boot applies the code lines and hands back everything the registry holds', async () => {
    await declareApiLine(line('api-only'));
    const { report, lines } = await syncDeclaredLines([line('code')], true);
    expect(report.applied).toEqual([`${SITE}/code`]);
    expect(lines.filter((l) => l.siteId === SITE).map((l) => l.lineId).sort()).toEqual(['api-only', 'code']);
  });
});
