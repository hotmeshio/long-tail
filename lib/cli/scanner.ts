import * as fs from 'fs';
import * as path from 'path';

import type { DiscoveredWorkflow } from './types';

const SKIP_DIRS = new Set(['node_modules', 'build', 'dist', '.git', '.docker-data', 'dashboard']);
const SKIP_PATTERNS = [/\.test\.ts$/, /\.spec\.ts$/, /\.compiled\.yaml$/, /\.d\.ts$/];

// ── Detection patterns ──────────────────────────────────────────────────

const HOTMESH_DURABLE = /(?:Durable\.workflow\.)?proxyActivities/;
const TEMPORAL_IMPORT = /@temporalio\/workflow/;
const WORKFLOW_PRIMITIVES = /(?:Durable\.workflow\.)?(sleep|condition|startChild|signal)/;
const COMPOSITION = /(?:executeChild|startChild|executeLT)/;
const EXPORTED_ASYNC = /export\s+async\s+function\s+(\w+)/g;

function detectFramework(source: string): 'hotmesh-durable' | 'temporal' | null {
  if (HOTMESH_DURABLE.test(source)) return 'hotmesh-durable';
  if (TEMPORAL_IMPORT.test(source)) return 'temporal';
  return null;
}

function hasWorkflowControlFlow(source: string): boolean {
  return WORKFLOW_PRIMITIVES.test(source) || COMPOSITION.test(source);
}

function extractExportedFunctions(source: string): string[] {
  const names: string[] = [];
  let match: RegExpExecArray | null;
  const pattern = new RegExp(EXPORTED_ASYNC.source, 'g');
  while ((match = pattern.exec(source)) !== null) {
    names.push(match[1]);
  }
  return names;
}

function extractActivityNames(source: string): string[] {
  const names: string[] = [];
  const pattern = /(?:const|let)\s*\{\s*([^}]+)\}\s*=\s*(?:Durable\.workflow\.)?proxyActivities/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    for (const name of match[1].split(',')) {
      const trimmed = name.trim();
      if (trimmed) names.push(trimmed);
    }
  }
  return names;
}

function extractPrimitives(source: string): string[] {
  const primitives: string[] = [];
  const seen = new Set<string>();
  const pattern = /Durable\.workflow\.(\w+)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    const p = match[1];
    if (p !== 'proxyActivities' && !seen.has(p)) {
      seen.add(p);
      primitives.push(p);
    }
  }
  if (/conditionLT/.test(source) && !seen.has('conditionLT')) primitives.push('conditionLT');
  if (/executeLT/.test(source) && !seen.has('executeLT')) primitives.push('executeLT');
  return primitives;
}

function extractActivityImports(source: string): string[] {
  const imports: string[] = [];
  const pattern = /import\s+\*\s+as\s+\w+\s+from\s+['"]([^'"]+)['"]/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    imports.push(match[1]);
  }
  return imports;
}

// ── Public API ──────────────────────────────────────────────────────────

/**
 * Scan a directory tree for durable/temporal workflow files.
 * Returns discovered workflows sorted by path.
 */
export function scanForWorkflows(
  rootDir: string,
  functionFilter?: string,
): DiscoveredWorkflow[] {
  const results: DiscoveredWorkflow[] = [];
  walkDir(rootDir, rootDir, results, functionFilter);
  return results.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

/**
 * Analyze a single file. Returns a DiscoveredWorkflow if it's a workflow, null otherwise.
 */
export function analyzeFile(
  filePath: string,
  baseDir: string,
  functionFilter?: string,
): DiscoveredWorkflow | null {
  const source = fs.readFileSync(filePath, 'utf-8');
  const framework = detectFramework(source);

  if (!framework && !hasWorkflowControlFlow(source)) return null;

  const exported = extractExportedFunctions(source);
  if (exported.length === 0) return null;

  const functionName = functionFilter
    ? exported.find((n) => n === functionFilter) || exported[0]
    : exported[0];

  return {
    path: filePath,
    relativePath: path.relative(baseDir, filePath),
    functionName,
    activities: extractActivityNames(source),
    primitives: extractPrimitives(source),
    activityImportPaths: extractActivityImports(source),
    framework: framework || 'unknown',
  };
}

function walkDir(
  dir: string,
  baseDir: string,
  results: DiscoveredWorkflow[],
  functionFilter?: string,
): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walkDir(path.join(dir, entry.name), baseDir, results, functionFilter);
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      if (SKIP_PATTERNS.some((p) => p.test(entry.name))) continue;
      const filePath = path.join(dir, entry.name);
      const workflow = analyzeFile(filePath, baseDir, functionFilter);
      if (workflow) results.push(workflow);
    }
  }
}
