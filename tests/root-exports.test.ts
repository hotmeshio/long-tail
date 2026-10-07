import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

// The package entry is what dependents import from. A helper that exists in
// a module but is missing from the root list compiles nowhere downstream, so
// the export list is pinned here for the workflow helpers the docs show.
describe('package root exports', () => {
  const source = readFileSync(join(__dirname, '..', 'index.ts'), 'utf-8');

  it('exports the workflow wait helpers the docs import from the root', () => {
    expect(source).toMatch(/export \{[^}]*\bconditional\b[^}]*\} from '\.\/services\/orchestrator\/condition'/);
    expect(source).toMatch(/export \{[^}]*\bconditionalAccumulator\b[^}]*\} from '\.\/services\/orchestrator\/condition'/);
    expect(source).toMatch(/export type \{[^}]*\bConditionAccumulatorConfig\b[^}]*\} from '\.\/services\/orchestrator\/condition'/);
  });

  it('exports the scan config types and validators dependents declare rules with', () => {
    const scan = source.match(/export \{([^}]*)\} from '\.\/services\/scan-code'/)?.[1] ?? '';
    for (const name of ['assertValidScanScheme', 'assertValidScanSteps', 'assertValidScanIdentityRule',
      'normalizeGtin', 'displayGtin', 'isValidGtin', 'ScanSchemeInput', 'ScanRuleInput']) {
      expect(scan).toContain(name);
    }
  });
});
