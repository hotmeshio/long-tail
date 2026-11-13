import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { dirname, join, relative, resolve } from 'path';

import * as contracts from '../../../services/machines/workflow-contracts';

// Workflow code on Temporal or DBOS imports the machine contracts, so
// nothing behind them may load Node built-ins, the database or HotMesh.
const ROOT = resolve(__dirname, '../../..');
const ENTRY = join(ROOT, 'services/machines/workflow-contracts.ts');
const RUNTIME_IMPORT = /(?:^|\n)\s*(?:import|export)\s+(?!type\b)(?:[^;'"]*?\sfrom\s+)?['"]([^'"]+)['"]/g;

function resolveModule(from: string, specifier: string): string {
  const base = resolve(dirname(from), specifier);
  const file = [`${base}.ts`, join(base, 'index.ts')].find(existsSync);
  if (!file) throw new Error(`cannot resolve ${specifier} from ${relative(ROOT, from)}`);
  return file;
}

/** Every module the entry loads at runtime, and each bare specifier it reaches. */
function runtimeGraph(entry: string): { modules: string[]; bare: string[] } {
  const seen = new Set<string>();
  const bare = new Set<string>();
  const visit = (file: string) => {
    if (seen.has(file)) return;
    seen.add(file);
    const source = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const [, specifier] of source.matchAll(RUNTIME_IMPORT)) {
      if (specifier.startsWith('.')) visit(resolveModule(file, specifier));
      else bare.add(specifier);
    }
  };
  visit(entry);
  return { modules: [...seen].map((f) => relative(ROOT, f)).sort(), bare: [...bare].sort() };
}

describe('machine workflow contracts', () => {
  it('load no package, Node built-in or server module', () => {
    const { modules, bare } = runtimeGraph(ENTRY);
    expect(bare).toEqual([]);
    expect(modules).toEqual([
      'lib/machines/line-roles.ts',
      'lib/machines/protocol/constants.ts',
      'services/machines/commands.ts',
      'services/machines/contracts.ts',
      'services/machines/forms.ts',
      'services/machines/rows.ts',
      'services/machines/workflow-contracts.ts',
    ]);
  });

  it('export what a line workflow writes', () => {
    for (const name of ['ROW_TYPE', 'DECISION', 'handoffDecisions', 'commandRow', 'commandTarget', 'operatorRole', 'machineRole', 'itemKeys', 'signalKeys']) {
      expect(contracts, name).toHaveProperty(name);
    }
  });

  it('build a command row for a machine on a line', () => {
    const line = { siteId: 's1', lineId: 'l1', machines: [{ machineId: 'm1', process: 'bond' }] } as any;
    const row = contracts.commandRow(contracts.commandTarget(line, 'm1'), 'start');
    expect(row).toMatchObject({ role: 'line-bond', type: contracts.ROW_TYPE.MACHINE_COMMAND, subtype: 'start' });
  });

  it('publish the entry at the package path machines/contracts', () => {
    expect(readFileSync(join(ROOT, 'machines/contracts.js'), 'utf8')).toContain("require('../build/services/machines/workflow-contracts')");
    expect(JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).files).toContain('machines/');
  });
});
