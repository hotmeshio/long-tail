import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '..', '..');
const SKIPPED_DIRS = new Set(['node_modules', 'build', 'dashboard', '.git', '.claude', 'docs']);

// Separate server processes, not Long Tail code.
const EXEMPT_FILES = new Set([
  'lib/http/index.ts',
  'tests/mock-oauth/server.ts',
  'examples/external-mcp-server/server.ts',
]);

const EXPRESS_IMPORT = /(?:from\s+|require\(\s*|import\(\s*)['"]express['"]/;

function listSourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRS.has(entry.name)) files.push(...listSourceFiles(full));
    } else if (/\.(ts|tsx|js|mjs|cjs)$/.test(entry.name)) {
      files.push(path.relative(ROOT, full).split(path.sep).join('/'));
    }
  }
  return files;
}

describe('HTTP boundary', () => {
  it('only lib/http imports express', () => {
    const offenders = listSourceFiles(ROOT)
      .filter((file) => !EXEMPT_FILES.has(file))
      .filter((file) => EXPRESS_IMPORT.test(readFileSync(path.join(ROOT, file), 'utf8')));

    expect(offenders).toEqual([]);
  });

  it('lib/http itself imports express', () => {
    const source = readFileSync(path.join(ROOT, 'lib/http/index.ts'), 'utf8');
    expect(EXPRESS_IMPORT.test(source)).toBe(true);
  });
});
